const express = require("express");
const { getStore } = require("../store");
const { authenticateToken } = require("../middleware/auth");
const { sanitizeSettings, titleFromMessage } = require("../services/tutor");

const router = express.Router();
router.use(authenticateToken);

const MAX_TITLE = 120;
const MAX_IMPORT_MESSAGES = 500;
const MAX_MESSAGE_LENGTH = 100000;

function cleanTitle(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

router.get("/", async (req, res, next) => {
    try {
        const conversations = await getStore().listConversations(req.user.id);
        res.json({ success: true, conversations });
    } catch (error) {
        next(error);
    }
});

router.post("/", async (req, res, next) => {
    try {
        const { title, settings } = req.body || {};
        const conversation = await getStore().createConversation(req.user.id, {
            title: cleanTitle(title) || "New conversation",
            settings: sanitizeSettings(settings),
        });
        res.status(201).json({ success: true, conversation });
    } catch (error) {
        next(error);
    }
});

/*
 * Imports conversations exported from EduAI, including the ones the previous version
 * kept only in browser localStorage. Each one is validated and stored for this user.
 */
router.post("/import", async (req, res, next) => {
    try {
        const items = Array.isArray(req.body?.conversations) ? req.body.conversations.slice(0, 200) : null;
        if (!items) {
            return res.status(400).json({ success: false, error: "Expected a list of conversations to import." });
        }

        const store = getStore();
        const imported = [];
        let skipped = 0;

        for (const item of items) {
            const messages = (Array.isArray(item?.messages) ? item.messages : [])
                .filter((message) => ["user", "assistant"].includes(message?.role) && typeof message.content === "string" && message.content.trim())
                .slice(0, MAX_IMPORT_MESSAGES)
                .map((message, index) => ({
                    role: message.role,
                    content: message.content.slice(0, MAX_MESSAGE_LENGTH),
                    createdAt: Number.isFinite(Number(message.createdAt)) ? Number(message.createdAt) : Date.now() + index,
                }));

            if (!messages.length) {
                skipped += 1;
                continue;
            }

            const createdAt = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : messages[0].createdAt;
            const updatedAt = Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : messages[messages.length - 1].createdAt;
            const title = cleanTitle(item.title);

            imported.push(await store.importConversation(req.user.id, {
                title: title && title !== "New chat" ? title : titleFromMessage(messages.find((message) => message.role === "user")?.content),
                settings: sanitizeSettings(item.settings),
                createdAt,
                updatedAt,
                messages,
            }));
        }

        res.status(201).json({ success: true, imported, skipped });
    } catch (error) {
        next(error);
    }
});

router.get("/:id", async (req, res, next) => {
    try {
        const conversation = await getStore().getConversation(req.user.id, req.params.id);
        if (!conversation) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }
        res.json({ success: true, conversation });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id", async (req, res, next) => {
    try {
        const { title, settings } = req.body || {};
        const update = {};

        if (title !== undefined) {
            update.title = cleanTitle(title);
            if (!update.title) return res.status(400).json({ success: false, error: "Title cannot be empty." });
        }
        if (settings !== undefined) update.settings = sanitizeSettings(settings);

        const conversation = await getStore().updateConversation(req.user.id, req.params.id, update);
        if (!conversation) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }
        res.json({ success: true, conversation });
    } catch (error) {
        next(error);
    }
});

/* Kept for compatibility with the original API. */
router.patch("/:id/title", async (req, res, next) => {
    try {
        const title = cleanTitle(req.body?.title);
        if (!title) return res.status(400).json({ success: false, error: "Title is required." });

        const conversation = await getStore().updateConversation(req.user.id, req.params.id, { title });
        if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });
        res.json({ success: true, conversation });
    } catch (error) {
        next(error);
    }
});

/* Kept for compatibility with the original API. */
router.post("/:id/messages", async (req, res, next) => {
    try {
        const { role, content } = req.body || {};
        if (!["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim()) {
            return res.status(400).json({ success: false, error: "A role (user or assistant) and message content are required." });
        }

        const store = getStore();
        const conversation = await store.getConversation(req.user.id, req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

        const message = await store.addMessage(conversation.id, { role, content: content.slice(0, MAX_MESSAGE_LENGTH) });
        res.status(201).json({ success: true, message });
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", async (req, res, next) => {
    try {
        const deleted = await getStore().deleteConversation(req.user.id, req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }
        res.json({ success: true, deletedConversationId: req.params.id });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
