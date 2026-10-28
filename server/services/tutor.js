/*
 * Tutor behaviour: prompt construction, context trimming, and parsing of structured
 * AI output for quizzes and answer checking.
 */

const LEVELS = {
    primary: "a primary-school student (ages 8-11). Use very simple words, short sentences, and concrete everyday examples.",
    middle: "a middle-school student (ages 11-14). Use plain language, define new terms, and use relatable examples.",
    high: "a high-school student. Use clear explanations, introduce correct terminology, and connect ideas to exam-style questions.",
    university: "a university student. Be precise and rigorous, use proper terminology, and mention underlying principles and edge cases.",
    professional: "an adult or professional learner. Be concise and practical, and focus on real-world application.",
};

const MODES = {
    explain: {
        label: "Explain",
        instructions:
            "Explain concepts clearly and in a logical order. Start with the core idea in one or two sentences, then build up with steps and an example. End with one short question that checks understanding.",
    },
    guided: {
        label: "Guided (Socratic)",
        instructions:
            "Act as a Socratic tutor. Do NOT give the final answer straight away. Ask one guiding question at a time, offer a hint when the student is stuck, and confirm or gently correct their reasoning. Only reveal the full solution if the student explicitly asks for it after trying, or after several unsuccessful attempts.",
    },
    practice: {
        label: "Practice",
        instructions:
            "Help the student practise. Give one problem or question at a time, wait for their answer, then give specific feedback: what was right, what was wrong, why, and how to fix it. Gradually increase difficulty when they succeed.",
    },
    check: {
        label: "Check my work",
        instructions:
            "The student will share an answer, solution, essay or code. Evaluate it carefully: say clearly whether it is correct, point to the exact step or line where an error occurs, explain the misconception behind it, and suggest how to improve. Praise what is genuinely good. Do not rewrite the whole thing unless asked.",
    },
    revise: {
        label: "Exam revision",
        instructions:
            "Help the student revise efficiently for exams: summarise key points, highlight common mistakes and exam traps, use active recall questions, and suggest a short revision routine.",
    },
};

const DEFAULT_SETTINGS = { level: "high", mode: "explain", subject: "" };

function sanitizeSettings(input = {}) {
    const settings = { ...DEFAULT_SETTINGS };
    if (input && typeof input === "object") {
        if (LEVELS[input.level]) settings.level = input.level;
        if (MODES[input.mode]) settings.mode = input.mode;
        if (typeof input.subject === "string") settings.subject = input.subject.trim().slice(0, 80);
        if (Array.isArray(input.materialIds)) {
            settings.materialIds = input.materialIds.filter((id) => typeof id === "string" && id.length <= 64).slice(0, 3);
        }
    }
    return settings;
}

const CORE_PRINCIPLES = `
You are EduAI, a patient and knowledgeable personal tutor. Your goal is that the student genuinely understands, not just that they get an answer.

Teaching principles:
- Adapt depth, vocabulary and examples to the student's level.
- Build understanding step by step. Prefer worked examples and analogies over walls of text.
- Encourage active learning: when it helps, end with a short question for the student to try.
- If the student seems to want you to do graded homework for them, guide them through it instead of handing over a finished answer.
- When the student makes a mistake, explain the misconception kindly and specifically.
- For programming: explain what the code does and why, use fenced code blocks with a language tag, and when debugging, identify the root cause before giving the fix.
- For maths and science: show each step and check units and signs.

Honesty and accuracy:
- Be accurate. If you are not sure, say so plainly and suggest how the student can verify it (textbook, teacher, official documentation).
- Never invent citations, quotes, statistics, URLs, or sources. Only mention a specific source if you are confident it exists, and say it should be checked.
- Never claim to have read a file, website or document unless its text is included below in this conversation. If the student refers to material you were not given, say you cannot see it and ask them to upload or paste it.
- Distinguish established facts from simplifications or opinions.

Format:
- Use Markdown: short headings, numbered steps, bullet lists, tables, and fenced code blocks where they improve clarity.
- Write maths inline with plain text or code formatting (for example \`x^2 + 3x = 0\`).
- Keep answers focused. Do not repeat the question back. Offer to go deeper rather than writing everything at once.
`.trim();

const MATERIAL_CHAR_BUDGET = 24000;

function buildSystemPrompt(settings, materials = []) {
    const level = LEVELS[settings.level] || LEVELS.high;
    const mode = MODES[settings.mode] || MODES.explain;

    let prompt = `${CORE_PRINCIPLES}

Student profile:
- The student is ${level}
${settings.subject ? `- Current subject or course: ${settings.subject}\n` : ""}
Current tutoring mode: ${mode.label}
${mode.instructions}`;

    if (materials.length) {
        let remaining = MATERIAL_CHAR_BUDGET;
        const blocks = [];

        for (const material of materials) {
            if (remaining <= 0) break;
            const text = material.content || "";
            const excerpt = text.slice(0, remaining);
            remaining -= excerpt.length;
            const partial = excerpt.length < text.length || material.truncated;

            blocks.push(
                `<material name="${material.name.replace(/"/g, "'")}" ${partial ? 'note="only the beginning of this document was provided"' : 'note="full text"'}>\n${excerpt}\n</material>`
            );
        }

        prompt += `

Study material shared by the student (extracted text; formatting, images and diagrams were not preserved):
${blocks.join("\n\n")}

When answering questions about this material, base your answer on it and say when something is not covered in it. If only the beginning of a document was provided, tell the student that you could only read part of it.`;
    }

    return prompt;
}

const HISTORY_CHAR_BUDGET = 40000;
const HISTORY_MAX_MESSAGES = 40;

/* Keeps the most recent turns that fit the budget, always starting on a user turn. */
function buildHistory(messages) {
    const usable = messages.filter((message) => (message.role === "user" || message.role === "assistant") && message.content?.trim());
    const selected = [];
    let used = 0;

    for (let index = usable.length - 1; index >= 0; index -= 1) {
        const message = usable[index];
        if (selected.length >= HISTORY_MAX_MESSAGES) break;
        if (used + message.content.length > HISTORY_CHAR_BUDGET && selected.length) break;
        selected.unshift({ role: message.role, content: message.content.slice(0, HISTORY_CHAR_BUDGET) });
        used += message.content.length;
    }

    while (selected.length && selected[0].role !== "user") selected.shift();
    return selected;
}

function titleFromMessage(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "New conversation";
    return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
}

/* ---------------- Quizzes ---------------- */

function buildQuizPrompt({ topic, level, count, questionType, sourceText }) {
    const typeRule = {
        multiple_choice: "All questions must be multiple choice.",
        short_answer: "All questions must be short answer.",
        mixed: "Mix multiple choice and short answer questions (roughly two thirds multiple choice).",
    }[questionType] || "Mix multiple choice and short answer questions.";

    const system = `You write accurate, fair practice quizzes for students. You output only valid JSON.

Rules:
- Questions must test understanding, not trivia. Include at least one application or "why" question.
- Every question must have one unambiguous correct answer that you are confident is factually correct.
- Multiple choice: exactly 4 options, plausible distractors based on common misconceptions, one correct option.
- Short answer: answer expected in one or two sentences or a short value; give a model answer.
- Each question needs a brief explanation of why the correct answer is right.
- ${sourceText ? "Base every question strictly on the provided source material. Do not add facts that are not in it." : "Use well-established knowledge only."}
- ${typeRule}

JSON shape:
{"title": string, "questions": [{"type": "multiple_choice" | "short_answer", "question": string, "options": [string, string, string, string] (multiple_choice only), "answerIndex": number (multiple_choice only, 0-3), "answer": string (short_answer only), "explanation": string}]}`;

    const user = `Create a ${count}-question quiz for ${LEVELS[level] || LEVELS.high}
Topic: ${topic || "the source material below"}${sourceText ? `\n\nSource material:\n"""\n${sourceText}\n"""` : ""}`;

    return [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
}

function extractJson(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}

function clean(value, max) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/* Validates model output so a malformed quiz never reaches the student. */
function parseQuiz(text, expectedCount) {
    const data = extractJson(text);
    if (!data || !Array.isArray(data.questions)) return null;

    const questions = [];
    for (const raw of data.questions) {
        const question = clean(raw?.question, 600);
        const explanation = clean(raw?.explanation, 1200);
        if (!question) continue;

        const options = Array.isArray(raw.options) ? raw.options.map((option) => clean(option, 300)).filter(Boolean) : [];
        const answerIndex = Number(raw.answerIndex);
        const isMultipleChoice = raw.type !== "short_answer" && options.length >= 2;

        if (isMultipleChoice) {
            if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) continue;
            if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) continue;
            questions.push({ type: "multiple_choice", question, options: options.slice(0, 6), answerIndex, explanation });
        } else {
            const answer = clean(raw.answer, 600);
            if (!answer) continue;
            questions.push({ type: "short_answer", question, answer, explanation });
        }
    }

    if (!questions.length) return null;
    return {
        title: clean(data.title, 120),
        questions: questions.slice(0, expectedCount || questions.length),
    };
}

function buildAnswerCheckPrompt({ level, items }) {
    const system = `You are a fair, encouraging examiner marking short answers for ${LEVELS[level] || LEVELS.high}
Mark each answer against the model answer. Accept answers that are correct in meaning even if worded differently or slightly incomplete; award "partial" when the core idea is present but something important is missing or slightly wrong.
Feedback must be specific, 1-3 sentences, addressed to the student ("you"), and explain the misconception if any. Output only valid JSON:
{"results": [{"id": number, "verdict": "correct" | "partial" | "incorrect", "feedback": string}]}`;

    const user = items
        .map((item) => `Question ${item.id}: ${item.question}\nModel answer: ${item.answer}\nStudent answer: ${item.response || "(no answer given)"}`)
        .join("\n\n");

    return [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
}

function normalizeVerdict(value) {
    const verdict = String(value || "").toLowerCase();
    if (/^partial/.test(verdict)) return "partial";
    if (/^(incorrect|wrong)/.test(verdict)) return "incorrect";
    if (/^correct/.test(verdict)) return "correct";
    return null;
}

/*
 * Returns one mark per expected id (1..count), or null if the output can't be trusted.
 * Smaller models sometimes renumber items, so when ids don't line up but exactly one
 * valid result was returned per answer, results are matched by position.
 */
function parseAnswerCheck(text, count) {
    const data = extractJson(text);
    if (!data || !Array.isArray(data.results)) return null;

    const valid = data.results
        .map((item) => ({ id: Number(item?.id), verdict: normalizeVerdict(item?.verdict), feedback: clean(item?.feedback, 800) }))
        .filter((item) => item.verdict);

    const byId = new Map(valid.filter((item) => Number.isInteger(item.id)).map((item) => [item.id, item]));
    const expected = Array.from({ length: count }, (_, index) => index + 1);

    let marks = expected.map((id) => byId.get(id));
    if (marks.some((mark) => !mark) && valid.length === count) marks = valid;
    if (marks.some((mark) => !mark)) return null;

    return marks.map(({ verdict, feedback }) => ({ verdict, feedback }));
}

module.exports = {
    LEVELS,
    MODES,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    buildSystemPrompt,
    buildHistory,
    titleFromMessage,
    buildQuizPrompt,
    parseQuiz,
    buildAnswerCheckPrompt,
    parseAnswerCheck,
};
