const express = require("express");
const { query } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.get("/stats", authenticateToken, async (req, res, next) => {
    try {
        const [userResult, convoResult, messageResult] = await Promise.all([
            query("SELECT COUNT(*)::int AS total_users FROM users"),
            query("SELECT COUNT(*)::int AS total_conversations FROM conversations"),
            query("SELECT COUNT(*)::int AS total_messages FROM messages")
        ]);

        res.json({
            success: true,
            stats: {
                totalUsers: userResult.rows[0].total_users,
                totalConversations: convoResult.rows[0].total_conversations,
                totalMessages: messageResult.rows[0].total_messages,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.get("/profile", authenticateToken, async (req, res, next) => {
    try {
        const result = await query(
            "SELECT id, name, email, role, created_at FROM users WHERE id = $1",
            [req.user.id]
        );

        res.json({ success: true, user: result.rows[0] || null });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
