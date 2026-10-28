const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { getAIStatus } = require("../services/ai");
const { getStore } = require("../store");
const { LEVELS, MODES } = require("../services/tutor");

const router = express.Router();

/* Lets the client tell students up front when the AI service is unavailable, and why. */
router.get("/", authenticateToken, async (req, res, next) => {
    try {
        const ai = await getAIStatus({ force: req.query.refresh === "1" });
        res.json({
            success: true,
            ai,
            storage: getStore().kind,
            tutor: {
                levels: Object.keys(LEVELS),
                modes: Object.fromEntries(Object.entries(MODES).map(([key, mode]) => [key, mode.label])),
            },
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
