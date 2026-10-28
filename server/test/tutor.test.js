const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildHistory, buildSystemPrompt, parseQuiz, parseAnswerCheck, sanitizeSettings, titleFromMessage } = require("../services/tutor");

test("buildHistory keeps recent turns within budget and starts on a user turn", () => {
    const messages = [];
    for (let index = 0; index < 60; index += 1) {
        messages.push({ role: index % 2 ? "assistant" : "user", content: `message ${index}` });
    }
    const history = buildHistory(messages);
    assert.ok(history.length <= 40);
    assert.equal(history[0].role, "user");
    assert.equal(history.at(-1).content, "message 59");

    const huge = [{ role: "user", content: "x".repeat(30000) }, { role: "assistant", content: "y".repeat(30000) }, { role: "user", content: "latest" }];
    const trimmed = buildHistory(huge);
    assert.equal(trimmed.at(-1).content, "latest");
    assert.ok(trimmed.reduce((sum, message) => sum + message.content.length, 0) <= 40000);
});

test("buildSystemPrompt marks partially provided material honestly", () => {
    const prompt = buildSystemPrompt(sanitizeSettings({}), [{ name: "book.pdf", content: "z".repeat(30000), truncated: false }]);
    assert.match(prompt, /only the beginning of this document was provided/);
    assert.match(prompt, /could only read part of it/);
});

test("parseQuiz accepts fenced JSON and rejects invalid questions", () => {
    const output = "```json\n" + JSON.stringify({
        title: "T",
        questions: [
            { type: "multiple_choice", question: "Q1", options: ["a", "b", "c", "d"], answerIndex: 2, explanation: "e" },
            { type: "multiple_choice", question: "Q2", options: ["a", "b", "c", "d"], answerIndex: 7 },
            { type: "short_answer", question: "Q3", answer: "" },
            { type: "short_answer", question: "Q4", answer: "yes" },
        ],
    }) + "\n```";
    const quiz = parseQuiz(output, 10);
    assert.deepEqual(quiz.questions.map((question) => question.question), ["Q1", "Q4"]);
    assert.equal(parseQuiz("not json", 5), null);
});

test("parseAnswerCheck matches by id, falls back to position, and rejects incomplete output", () => {
    const byId = parseAnswerCheck(JSON.stringify({ results: [{ id: 2, verdict: "incorrect", feedback: "No" }, { id: 1, verdict: "Correct", feedback: "Good" }] }), 2);
    assert.deepEqual(byId.map((mark) => mark.verdict), ["correct", "incorrect"]);

    const renumbered = parseAnswerCheck(JSON.stringify({ results: [{ id: 7, verdict: "partially correct", feedback: "Half" }] }), 1);
    assert.equal(renumbered[0].verdict, "partial");

    assert.equal(parseAnswerCheck(JSON.stringify({ results: [{ id: 1, verdict: "maybe" }] }), 1), null);
    assert.equal(parseAnswerCheck(JSON.stringify({ results: [{ id: 1, verdict: "correct" }] }), 2), null);
    assert.equal(parseAnswerCheck("not json", 1), null);
});

test("sanitizeSettings and titleFromMessage", () => {
    assert.deepEqual(sanitizeSettings({ level: "university", mode: "practice", subject: "  Chemistry ", extra: 1 }), { level: "university", mode: "practice", subject: "Chemistry" });
    assert.equal(sanitizeSettings({ level: "<script>" }).level, "high");
    assert.equal(titleFromMessage("   "), "New conversation");
    assert.ok(titleFromMessage("a".repeat(100)).length <= 58);
});
