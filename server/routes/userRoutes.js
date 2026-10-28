const express = require("express");
const { getStore } = require("../store");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/* Personal learning statistics. (Previously returned site-wide user counts to any user.) */
router.get("/stats", authenticateToken, async (req, res, next) => {
    try {
        const store = getStore();
        const [stats, quizzes] = await Promise.all([store.getStats(req.user.id), store.listQuizzes(req.user.id)]);

        const completed = quizzes.filter((quiz) => quiz.status === "completed" && quiz.total > 0);
        const averageScore = completed.length
            ? Math.round((completed.reduce((sum, quiz) => sum + quiz.score / quiz.total, 0) / completed.length) * 100)
            : null;

        // Topics where the latest attempt scored below 70% are worth revisiting.
        const latestByTopic = new Map();
        for (const quiz of completed) {
            const key = (quiz.topic || quiz.title || "").toLowerCase();
            if (key && !latestByTopic.has(key)) latestByTopic.set(key, quiz);
        }
        const toReview = [...latestByTopic.values()]
            .filter((quiz) => quiz.score / quiz.total < 0.7)
            .slice(0, 6)
            .map((quiz) => ({ quizId: quiz.id, topic: quiz.topic || quiz.title, percent: Math.round((quiz.score / quiz.total) * 100) }));

        const recent = completed.slice(0, 10).map((quiz) => ({
            id: quiz.id,
            topic: quiz.topic || quiz.title,
            score: quiz.score,
            total: quiz.total,
            completedAt: quiz.completedAt,
        }));

        res.json({
            success: true,
            stats: { ...stats, quizzesCompleted: completed.length, averageScore, recent, toReview },
        });
    } catch (error) {
        next(error);
    }
});

router.get("/profile", authenticateToken, async (req, res, next) => {
    try {
        const user = await getStore().getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: "User not found." });
        }
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt } });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
