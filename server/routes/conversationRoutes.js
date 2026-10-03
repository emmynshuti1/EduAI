const express = require("express");
const { query } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");
const {
    listConversationsForUser,
    createMemoryConversation,
    getMemoryConversation,
    updateMemoryConversationTitle,
    addMemoryMessage,
    deleteMemoryConversation,
} = require("../utils/fallbackStore");

const router = express.Router();

function useInMemoryStore() {
    return !process.env.DATABASE_URL && !process.env.POSTGRES_URL;
}

function normalizeConversation(row) {
    return {
        id: row.id,
        title: row.title,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        messages: [],
    };
}

router.get("/", authenticateToken, async (req, res, next) => {
    try {
        if (useInMemoryStore()) {
            const conversations = listConversationsForUser(req.user.id);
            return res.json({ success: true, conversations });
        }

        const result = await query(
            `SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC, created_at DESC`,
            [req.user.id]
        );

        const conversations = await Promise.all(
            result.rows.map(async (row) => {
                const messagesResult = await query(
                    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
                    [row.id]
                );

                return {
                    ...normalizeConversation(row),
                    messages: messagesResult.rows.map((message) => ({
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        createdAt: message.created_at ? new Date(message.created_at).getTime() : Date.now(),
                    })),
                };
            })
        );

        res.json({ success: true, conversations });
    } catch (error) {
        next(error);
    }
});

router.post("/", authenticateToken, async (req, res, next) => {
    try {
        const { title = "New chat" } = req.body || {};

        if (useInMemoryStore()) {
            const conversation = createMemoryConversation(req.user.id, title || "New chat");
            return res.status(201).json({ success: true, conversation });
        }

        const result = await query(
            `INSERT INTO conversations (user_id, title, updated_at)
             VALUES ($1, $2, NOW())
             RETURNING *`,
            [req.user.id, title || "New chat"]
        );

        res.status(201).json({
            success: true,
            conversation: normalizeConversation(result.rows[0]),
        });
    } catch (error) {
        next(error);
    }
});

router.get("/:id", authenticateToken, async (req, res, next) => {
    try {
        if (useInMemoryStore()) {
            const conversation = getMemoryConversation(req.user.id, req.params.id);
            if (!conversation) {
                return res.status(404).json({ success: false, error: "Conversation not found." });
            }

            return res.json({ success: true, conversation });
        }

        const conversationResult = await query(
            `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );

        if (!conversationResult.rows[0]) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        const messagesResult = await query(
            `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [req.params.id]
        );

        res.json({
            success: true,
            conversation: {
                ...normalizeConversation(conversationResult.rows[0]),
                messages: messagesResult.rows.map((message) => ({
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    createdAt: message.created_at ? new Date(message.created_at).getTime() : Date.now(),
                })),
            },
        });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/title", authenticateToken, async (req, res, next) => {
    try {
        const { title } = req.body || {};
        if (!title || !String(title).trim()) {
            return res.status(400).json({ success: false, error: "Title is required." });
        }

        if (useInMemoryStore()) {
            const updated = updateMemoryConversationTitle(req.user.id, req.params.id, String(title).trim());
            if (!updated) {
                return res.status(404).json({ success: false, error: "Conversation not found." });
            }
            return res.json({ success: true, conversation: updated });
        }

        const result = await query(
            `UPDATE conversations
             SET title = $1, updated_at = NOW()
             WHERE id = $2 AND user_id = $3
             RETURNING *`,
            [String(title).trim(), req.params.id, req.user.id]
        );

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        res.json({ success: true, conversation: normalizeConversation(result.rows[0]) });
    } catch (error) {
        next(error);
    }
});

router.post("/:id/messages", authenticateToken, async (req, res, next) => {
    try {
        const { role, content } = req.body || {};
        if (!role || !content || !String(content).trim()) {
            return res.status(400).json({ success: false, error: "Message content is required." });
        }

        if (useInMemoryStore()) {
            const message = addMemoryMessage(req.user.id, req.params.id, role, String(content));
            if (!message) {
                return res.status(404).json({ success: false, error: "Conversation not found." });
            }
            return res.status(201).json({ success: true, message });
        }

        const conversationCheck = await query(
            `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );

        if (!conversationCheck.rows[0]) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        const result = await query(
            `INSERT INTO messages (conversation_id, role, content)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [req.params.id, role, String(content)]
        );

        await query(
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
            [req.params.id]
        );

        res.status(201).json({
            success: true,
            message: {
                id: result.rows[0].id,
                role: result.rows[0].role,
                content: result.rows[0].content,
                createdAt: result.rows[0].created_at ? new Date(result.rows[0].created_at).getTime() : Date.now(),
            },
        });
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", authenticateToken, async (req, res, next) => {
    try {
        if (useInMemoryStore()) {
            const deleted = deleteMemoryConversation(req.user.id, req.params.id);
            if (!deleted) {
                return res.status(404).json({ success: false, error: "Conversation not found." });
            }
            return res.json({ success: true, deletedConversationId: req.params.id });
        }

        const result = await query(
            `DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        res.json({ success: true, deletedConversationId: result.rows[0].id });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
