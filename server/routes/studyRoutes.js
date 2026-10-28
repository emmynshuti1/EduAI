const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { getStore } = require("../store");
const { upload, handleUpload } = require("./materialRoutes");

/* Original study API, kept working on top of the shared store. */
const router = express.Router();
router.use(authenticateToken);

router.post("/upload-notes", upload.single("file"), handleUpload);

router.get("/sessions", async (req, res, next) => {
    try {
        res.json({ success: true, sessions: await getStore().listStudySessions(req.user.id) });
    } catch (error) {
        next(error);
    }
});

router.post("/sessions", async (req, res, next) => {
    try {
        const { topic, notes, status } = req.body || {};
        const session = await getStore().createStudySession(req.user.id, {
            topic: String(topic || "Untitled study session").slice(0, 255),
            notes: String(notes || "").slice(0, 20000),
            status: ["active", "completed", "paused"].includes(status) ? status : "active",
        });
        res.status(201).json({ success: true, session });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
