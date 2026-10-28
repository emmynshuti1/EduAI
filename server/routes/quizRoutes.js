const express = require("express");
const { getStore } = require("../store");
const { authenticateToken } = require("../middleware/auth");
const { getProvider, recordAIFailure, recordAISuccess } = require("../services/ai");
const { aiLimiter } = require("../middleware/rateLimits");
const { LEVELS, buildQuizPrompt, parseQuiz, buildAnswerCheckPrompt, parseAnswerCheck } = require("../services/tutor");

const router = express.Router();

const SOURCE_CHAR_LIMIT = 16000;
const QUESTION_TYPES = new Set(["multiple_choice", "short_answer", "mixed"]);

/* While a quiz is in progress the client never receives the answers. */
function toClientQuiz(quiz) {
    if (quiz.status === "completed") return quiz;
    return {
        ...quiz,
        questions: quiz.questions.map(({ type, question, options }) => ({ type, question, ...(options ? { options } : {}) })),
    };
}

function toSummary(quiz) {
    const { questions, responses, results, ...summary } = quiz;
    return summary;
}

function handleAIError(error, res, next) {
    if (error.name === "AIError") {
        recordAIFailure(error);
        console.error(`AI request failed [${error.code}]:`, error.cause?.message || error.message);
        return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    }
    return next(error);
}

/* Aborts the AI call if the student leaves while it is still running. */
function abortOnDisconnect(res) {
    const controller = new AbortController();
    res.on("close", () => {
        if (!res.writableFinished) controller.abort();
    });
    return controller.signal;
}


router.use(authenticateToken);

router.get("/", async (req, res, next) => {
    try {
        const quizzes = await getStore().listQuizzes(req.user.id);
        res.json({ success: true, quizzes: quizzes.map(toSummary) });
    } catch (error) {
        next(error);
    }
});

router.post("/", aiLimiter, async (req, res, next) => {
    try {
        const body = req.body || {};
        const topic = String(body.topic || "").replace(/\s+/g, " ").trim().slice(0, 200);
        const level = LEVELS[body.level] ? body.level : "high";
        const count = Math.min(10, Math.max(3, Number.parseInt(body.count, 10) || 5));
        const questionType = QUESTION_TYPES.has(body.questionType) ? body.questionType : "mixed";
        const store = getStore();

        let sourceText = "";
        let sourceLabel = null;

        if (body.materialId) {
            const [material] = await store.getMaterials(req.user.id, [String(body.materialId)]);
            if (!material) return res.status(404).json({ success: false, error: "That study material was not found." });
            sourceText = material.content;
            sourceLabel = material.name;
        } else if (body.noteId) {
            const note = await store.getNote(req.user.id, String(body.noteId));
            if (!note) return res.status(404).json({ success: false, error: "That note was not found." });
            sourceText = note.content;
            sourceLabel = note.title;
        }

        if (!topic && !sourceText) {
            return res.status(400).json({ success: false, error: "Enter a topic or choose material to be quizzed on." });
        }

        const sourcePartial = sourceText.length > SOURCE_CHAR_LIMIT;
        sourceText = sourceText.slice(0, SOURCE_CHAR_LIMIT);

        const provider = getProvider();
        const signal = abortOnDisconnect(res);
        const messages = buildQuizPrompt({ topic, level, count, questionType, sourceText });

        let quizData = null;
        for (let attempt = 0; attempt < 2 && !quizData; attempt += 1) {
            const output = await provider.complete({ messages, json: true, signal, maxTokens: 3500, temperature: 0.5 });
            quizData = parseQuiz(output, count);
        }
        recordAISuccess();

        if (!quizData) {
            return res.status(502).json({ success: false, code: "ai_bad_output", error: "The AI did not produce a usable quiz. Please try again, or try a more specific topic." });
        }

        const quiz = await store.createQuiz(req.user.id, {
            topic: topic || quizData.title || sourceLabel,
            title: quizData.title || topic || sourceLabel,
            level,
            sourceLabel: sourceLabel ? `${sourceLabel}${sourcePartial ? " (first part only)" : ""}` : null,
            questions: quizData.questions,
        });

        res.status(201).json({ success: true, quiz: toClientQuiz(quiz) });
    } catch (error) {
        if (res.destroyed) return;
        handleAIError(error, res, next);
    }
});

router.get("/:id", async (req, res, next) => {
    try {
        const quiz = await getStore().getQuiz(req.user.id, req.params.id);
        if (!quiz) return res.status(404).json({ success: false, error: "Quiz not found." });
        res.json({ success: true, quiz: toClientQuiz(quiz) });
    } catch (error) {
        next(error);
    }
});

router.post("/:id/submit", aiLimiter, async (req, res, next) => {
    try {
        const store = getStore();
        const quiz = await store.getQuiz(req.user.id, req.params.id);
        if (!quiz) return res.status(404).json({ success: false, error: "Quiz not found." });
        if (quiz.status === "completed") return res.status(409).json({ success: false, error: "This quiz has already been submitted.", quiz });

        const rawResponses = Array.isArray(req.body?.responses) ? req.body.responses : [];
        const responses = quiz.questions.map((question, index) => {
            const raw = rawResponses[index];
            if (question.type === "multiple_choice") {
                const choice = Number.parseInt(raw?.choice, 10);
                return { choice: Number.isInteger(choice) && choice >= 0 && choice < question.options.length ? choice : null };
            }
            return { text: String(raw?.text || "").trim().slice(0, 2000) };
        });

        const results = quiz.questions.map((question, index) => {
            if (question.type !== "multiple_choice") return null;
            const choice = responses[index].choice;
            if (choice === null) return { verdict: "incorrect", feedback: "No answer was selected." };
            return { verdict: choice === question.answerIndex ? "correct" : "incorrect", feedback: "" };
        });

        const toMark = [];
        quiz.questions.forEach((question, index) => {
            if (question.type !== "short_answer") return;
            if (!responses[index].text) {
                results[index] = { verdict: "incorrect", feedback: "No answer was given." };
            } else {
                toMark.push({ id: toMark.length + 1, index, question: question.question, answer: question.answer, response: responses[index].text });
            }
        });

        if (toMark.length) {
            const signal = abortOnDisconnect(res);
            const messages = buildAnswerCheckPrompt({ level: quiz.level, items: toMark });
            let marks = null;
            for (let attempt = 0; attempt < 2 && !marks; attempt += 1) {
                const output = await getProvider().complete({ messages, json: true, signal, temperature: 0.1 });
                marks = parseAnswerCheck(output, toMark.length);
            }
            recordAISuccess();

            if (!marks) {
                return res.status(502).json({ success: false, code: "ai_bad_output", error: "Your short answers could not be marked reliably. Please submit again." });
            }
            toMark.forEach((item, position) => { results[item.index] = marks[position]; });
        }

        const points = { correct: 1, partial: 0.5, incorrect: 0 };
        const score = results.reduce((sum, result) => sum + points[result.verdict], 0);
        const completed = await store.completeQuiz(req.user.id, quiz.id, { responses, results, score });

        res.json({ success: true, quiz: completed });
    } catch (error) {
        if (res.destroyed) return;
        handleAIError(error, res, next);
    }
});

router.delete("/:id", async (req, res, next) => {
    try {
        const deleted = await getStore().deleteQuiz(req.user.id, req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: "Quiz not found." });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
