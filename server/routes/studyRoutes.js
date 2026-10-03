const express = require("express");
const multer = require("multer");
const { authenticateToken } = require("../middleware/auth");
const { query } = require("../config/db");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload-notes", authenticateToken, upload.single("file"), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded." });
        }

        const result = await query(
            `INSERT INTO uploaded_files (user_id, filename, original_name, mime_type, size_bytes, storage_path)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                req.user.id,
                req.file.originalname,
                req.file.originalname,
                req.file.mimetype,
                req.file.size,
                `/uploads/${Date.now()}-${req.file.originalname}`,
            ]
        );

        res.status(201).json({
            success: true,
            file: result.rows[0],
            message: "File uploaded successfully.",
        });
    } catch (error) {
        next(error);
    }
});

router.get("/sessions", authenticateToken, async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM study_sessions WHERE user_id = $1 ORDER BY created_at DESC",
            [req.user.id]
        );

        res.json({ success: true, sessions: result.rows });
    } catch (error) {
        next(error);
    }
});

router.post("/sessions", authenticateToken, async (req, res, next) => {
    try {
        const { topic, notes, status } = req.body;
        const result = await query(
            `INSERT INTO study_sessions (user_id, topic, notes, status)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [req.user.id, topic || "Untitled study session", notes || "", status || "active"]
        );

        res.status(201).json({ success: true, session: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
