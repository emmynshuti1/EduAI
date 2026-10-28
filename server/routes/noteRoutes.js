const express = require("express");
const { getStore } = require("../store");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

const KINDS = new Set(["note", "explanation", "summary", "plan", "flashcards", "quiz-review"]);
const MAX_TITLE = 200;
const MAX_CONTENT = 100000;

function readNote(body = {}, { partial = false } = {}) {
    const note = {};

    if (body.title !== undefined || !partial) {
        note.title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
        if (!note.title) return { error: "Give the note a title." };
    }
    if (body.content !== undefined || !partial) {
        if (typeof body.content !== "string" || !body.content.trim()) return { error: "The note is empty." };
        if (body.content.length > MAX_CONTENT) return { error: "This note is too long (100,000 characters maximum)." };
        note.content = body.content;
    }
    if (!partial) {
        note.kind = KINDS.has(body.kind) ? body.kind : "note";
        note.sourceConversationId = typeof body.sourceConversationId === "string" ? body.sourceConversationId : null;
    }
    return { note };
}

router.get("/", async (req, res, next) => {
    try {
        res.json({ success: true, notes: await getStore().listNotes(req.user.id) });
    } catch (error) {
        next(error);
    }
});

router.post("/", async (req, res, next) => {
    try {
        const { note, error } = readNote(req.body);
        if (error) return res.status(400).json({ success: false, error });

        const store = getStore();
        if (note.sourceConversationId && !(await store.getConversation(req.user.id, note.sourceConversationId))) {
            note.sourceConversationId = null;
        }
        res.status(201).json({ success: true, note: await store.createNote(req.user.id, note) });
    } catch (error) {
        next(error);
    }
});

router.get("/:id", async (req, res, next) => {
    try {
        const note = await getStore().getNote(req.user.id, req.params.id);
        if (!note) return res.status(404).json({ success: false, error: "Note not found." });
        res.json({ success: true, note });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id", async (req, res, next) => {
    try {
        const { note, error } = readNote(req.body, { partial: true });
        if (error) return res.status(400).json({ success: false, error });

        const updated = await getStore().updateNote(req.user.id, req.params.id, note);
        if (!updated) return res.status(404).json({ success: false, error: "Note not found." });
        res.json({ success: true, note: updated });
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", async (req, res, next) => {
    try {
        const deleted = await getStore().deleteNote(req.user.id, req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: "Note not found." });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
