/* =========================================================
   QUIZZES VIEW
   Generate → answer → submit for marking → review mistakes.
   Answers stay on the server until the quiz is submitted.
========================================================= */

import { api } from "./api.js";
import { LEVELS, escapeHtml, formatDate, toast, confirmDialog, emptyState, setBusy, plural } from "./ui.js";

const VERDICT = {
    correct: { label: "Correct", icon: "✓" },
    partial: { label: "Partly correct", icon: "◐" },
    incorrect: { label: "Not quite", icon: "✕" },
};

export function createQuizzes(ctx) {
    const root = document.getElementById("quizzesRoot");
    const state = { quizzes: [], current: null, answers: [], generating: null, prefill: {} };

    async function show(params = {}) {
        state.prefill = params;
        if (params.quizId) return openQuiz(params.quizId);
        if (!state.current || params.topic || params.materialId || params.noteId) state.current = null;
        await refresh();
    }

    async function refresh() {
        if (state.current) return renderQuiz();
        renderHome({ loading: true });
        try {
            const [{ quizzes }] = await Promise.all([api.get("/quizzes"), ctx.materials.load(), ctx.notes.load()]);
            state.quizzes = quizzes;
        } catch (error) {
            toast(error.message, "error");
        }
        if (!state.current) renderHome();
    }

    /* ---------------- Home: generator + history ---------------- */

    function renderHome({ loading = false } = {}) {
        const defaults = ctx.tutorDefaults();
        const materials = ctx.materials.cached();
        const notes = ctx.notes.cached();
        const prefill = state.prefill || {};
        const source = prefill.materialId ? `material:${prefill.materialId}` : prefill.noteId ? `note:${prefill.noteId}` : "";

        root.innerHTML = `
            <header class="workspace-header">
                <div>
                    <p class="section-kicker">PRACTICE</p>
                    <h1>Quizzes</h1>
                    <p class="workspace-lede">Test yourself on any topic or on your own material. Your answers are marked with feedback on every mistake.</p>
                </div>
            </header>

            <form class="card quiz-builder" id="quizBuilder">
                <h2>Create a quiz</h2>
                <div class="form-grid">
                    <label class="field-block span-2">
                        <span>Topic</span>
                        <input class="text-input" name="topic" maxlength="200" value="${escapeHtml(prefill.topic || "")}"
                            placeholder="e.g. Cell respiration, quadratic equations, Python loops" />
                    </label>
                    <label class="field-block span-2">
                        <span>Base it on <small>(optional)</small></span>
                        <select class="text-input" name="source">
                            <option value="">General knowledge of the topic</option>
                            ${materials.length ? `<optgroup label="Study materials">${materials.map((material) => `<option value="material:${escapeHtml(material.id)}" ${source === `material:${material.id}` ? "selected" : ""}>${escapeHtml(material.name)}</option>`).join("")}</optgroup>` : ""}
                            ${notes.length ? `<optgroup label="Notes">${notes.map((note) => `<option value="note:${escapeHtml(note.id)}" ${source === `note:${note.id}` ? "selected" : ""}>${escapeHtml(note.title)}</option>`).join("")}</optgroup>` : ""}
                        </select>
                    </label>
                    <label class="field-block">
                        <span>Level</span>
                        <select class="text-input" name="level">
                            ${Object.entries(LEVELS).map(([key, label]) => `<option value="${key}" ${key === defaults.level ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
                        </select>
                    </label>
                    <label class="field-block">
                        <span>Questions</span>
                        <select class="text-input" name="count">
                            ${[3, 5, 8, 10].map((count) => `<option value="${count}" ${count === 5 ? "selected" : ""}>${count}</option>`).join("")}
                        </select>
                    </label>
                    <label class="field-block span-2">
                        <span>Question type</span>
                        <select class="text-input" name="questionType">
                            <option value="mixed">Mixed (multiple choice + short answer)</option>
                            <option value="multiple_choice">Multiple choice only</option>
                            <option value="short_answer">Short answer only</option>
                        </select>
                    </label>
                </div>
                <div class="form-actions">
                    <p class="form-hint" id="quizBuilderHint">Short answers are marked by the AI and explained.</p>
                    <button type="button" class="btn btn-quiet hidden" id="quizCancel">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="quizGenerate">Generate quiz</button>
                </div>
            </form>

            <section class="workspace-section">
                <h2>Your quizzes</h2>
                ${loading ? `<div class="skeleton-list"><span></span><span></span></div>` : historyMarkup()}
            </section>`;

        const form = root.querySelector("#quizBuilder");
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            generate(new FormData(form));
        });
        root.querySelector("#quizCancel").addEventListener("click", () => state.generating?.abort());
        root.querySelector(".quiz-history")?.addEventListener("click", onHistoryClick);
        if (!prefill.topic && !source) form.elements.topic.focus({ preventScroll: true });
    }

    function historyMarkup() {
        if (!state.quizzes.length) {
            return emptyState({ icon: "?", title: "No quizzes yet", text: "Create your first quiz above. Results are saved here so you can track what to review." });
        }
        return `<ul class="quiz-history item-list">${state.quizzes.map((quiz) => {
            const done = quiz.status === "completed";
            const percent = done && quiz.total ? Math.round((quiz.score / quiz.total) * 100) : null;
            return `
                <li class="list-row" data-id="${escapeHtml(quiz.id)}">
                    <button type="button" class="list-row-main" data-action="open">
                        <span class="score-badge ${percent === null ? "pending" : percent >= 70 ? "good" : percent >= 40 ? "mid" : "low"}">${percent === null ? "…" : `${percent}%`}</span>
                        <span class="list-row-text">
                            <b>${escapeHtml(quiz.title || quiz.topic)}</b>
                            <small>${escapeHtml([LEVELS[quiz.level], plural(quiz.total, "question"), quiz.sourceLabel ? `from ${quiz.sourceLabel}` : null, done ? `Completed ${formatDate(quiz.completedAt)}` : "Not finished"].filter(Boolean).join(" · "))}</small>
                        </span>
                    </button>
                    <button type="button" class="icon-button row-delete" data-action="delete" aria-label="Delete quiz" title="Delete">×</button>
                </li>`;
        }).join("")}</ul>`;
    }

    async function onHistoryClick(event) {
        const button = event.target.closest("[data-action]");
        const id = event.target.closest("[data-id]")?.dataset.id;
        if (!button || !id) return;
        if (button.dataset.action === "open") return openQuiz(id);
        if (button.dataset.action === "delete") {
            const ok = await confirmDialog({ title: "Delete this quiz?", message: "Its result will be removed from your progress.", confirmLabel: "Delete", danger: true });
            if (!ok) return;
            try {
                await api.delete(`/quizzes/${id}`);
                state.quizzes = state.quizzes.filter((quiz) => quiz.id !== id);
                renderHome();
            } catch (error) {
                toast(error.message, "error");
            }
        }
    }

    async function generate(formData) {
        if (state.generating) return;
        const [kind, id] = String(formData.get("source") || "").split(":");
        const body = {
            topic: String(formData.get("topic") || "").trim(),
            level: formData.get("level"),
            count: Number(formData.get("count")),
            questionType: formData.get("questionType"),
            ...(kind === "material" ? { materialId: id } : {}),
            ...(kind === "note" ? { noteId: id } : {}),
        };
        if (!body.topic && !kind) {
            toast("Enter a topic, or choose a material or note to be quizzed on.", "error");
            root.querySelector('[name="topic"]').focus();
            return;
        }

        const button = root.querySelector("#quizGenerate");
        const cancel = root.querySelector("#quizCancel");
        const hint = root.querySelector("#quizBuilderHint");
        const controller = new AbortController();
        state.generating = controller;
        setBusy(button, true, "Writing your quiz…");
        cancel.classList.remove("hidden");
        hint.textContent = "This usually takes 10–30 seconds.";

        try {
            const { quiz } = await api.post("/quizzes", body, { signal: controller.signal });
            state.prefill = {};
            state.current = quiz;
            state.answers = quiz.questions.map(() => null);
            state.quizzes.unshift(quiz);
            renderQuiz();
        } catch (error) {
            if (error.name !== "AbortError") {
                toast(error.message, "error");
                if (error.code?.startsWith("ai_")) ctx.onAIError?.(error);
            }
            if (button.isConnected) {
                setBusy(button, false);
                cancel.classList.add("hidden");
                hint.textContent = "Short answers are marked by the AI and explained.";
            }
        } finally {
            state.generating = null;
        }
    }

    async function openQuiz(id) {
        try {
            const { quiz } = await api.get(`/quizzes/${id}`);
            state.current = quiz;
            state.answers = quiz.questions.map(() => null);
            renderQuiz();
        } catch (error) {
            toast(error.message, "error");
            state.current = null;
            renderHome();
        }
    }

    /* ---------------- Taking a quiz ---------------- */

    function renderQuiz() {
        const quiz = state.current;
        if (quiz.status === "completed") return renderResults();

        root.innerHTML = `
            <header class="workspace-header compact">
                <button type="button" class="link-button back-link" data-back>← All quizzes</button>
                <h1>${escapeHtml(quiz.title || quiz.topic)}</h1>
                <p class="workspace-lede">${escapeHtml([LEVELS[quiz.level], plural(quiz.questions.length, "question"), quiz.sourceLabel ? `Based on ${quiz.sourceLabel}` : null].filter(Boolean).join(" · "))}</p>
                <div class="quiz-progress" aria-hidden="true"><i style="width:0%"></i></div>
            </header>
            <form id="quizForm" class="quiz-form">
                ${quiz.questions.map((question, index) => questionMarkup(question, index)).join("")}
                <div class="form-actions sticky-actions">
                    <p class="form-hint" id="quizAnswered"></p>
                    <button type="submit" class="btn btn-primary" id="quizSubmit">Submit answers</button>
                </div>
            </form>`;

        root.querySelector("[data-back]").addEventListener("click", backToList);
        const form = root.querySelector("#quizForm");
        form.addEventListener("change", () => syncAnswers(form));
        form.addEventListener("input", () => syncAnswers(form));
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            submit(form);
        });
        syncAnswers(form);
        root.scrollTop = 0;
    }

    function questionMarkup(question, index) {
        const number = index + 1;
        const body = question.type === "multiple_choice"
            ? `<div class="options" role="radiogroup" aria-labelledby="q${number}-label">${question.options.map((option, optionIndex) => `
                <label class="option">
                    <input type="radio" name="q${index}" value="${optionIndex}" />
                    <span class="option-letter" aria-hidden="true">${String.fromCharCode(65 + optionIndex)}</span>
                    <span>${escapeHtml(option)}</span>
                </label>`).join("")}</div>`
            : `<label class="sr-only" for="q${index}-text">Your answer to question ${number}</label>
               <textarea class="text-input answer-input" id="q${index}-text" name="q${index}" rows="3" maxlength="2000" placeholder="Write your answer in a sentence or two…"></textarea>`;

        return `
            <fieldset class="card question-card">
                <legend class="question-head" id="q${number}-label"><span class="question-number">Q${number}</span>${escapeHtml(question.question)}</legend>
                <p class="question-type">${question.type === "multiple_choice" ? "Choose one answer" : "Short answer"}</p>
                ${body}
            </fieldset>`;
    }

    function syncAnswers(form) {
        const quiz = state.current;
        state.answers = quiz.questions.map((question, index) => {
            if (question.type === "multiple_choice") {
                const checked = form.querySelector(`input[name="q${index}"]:checked`);
                return checked ? { choice: Number(checked.value) } : null;
            }
            const text = form.querySelector(`[name="q${index}"]`).value.trim();
            return text ? { text } : null;
        });
        const answered = state.answers.filter(Boolean).length;
        root.querySelector("#quizAnswered").textContent = `${answered} of ${quiz.questions.length} answered`;
        root.querySelector(".quiz-progress i").style.width = `${(answered / quiz.questions.length) * 100}%`;
    }

    async function submit(form) {
        const quiz = state.current;
        const unanswered = state.answers.filter((answer) => !answer).length;
        if (unanswered) {
            const ok = await confirmDialog({
                title: `Submit with ${plural(unanswered, "unanswered question")}?`,
                message: "Unanswered questions are marked as incorrect.",
                confirmLabel: "Submit anyway",
            });
            if (!ok) return;
        }

        const button = root.querySelector("#quizSubmit");
        setBusy(button, true, "Marking…");
        form.querySelectorAll("input, textarea").forEach((input) => { input.readOnly = true; });

        try {
            const { quiz: marked } = await api.post(`/quizzes/${quiz.id}/submit`, {
                responses: state.answers.map((answer) => answer || {}),
            });
            state.current = marked;
            const index = state.quizzes.findIndex((item) => item.id === marked.id);
            if (index !== -1) state.quizzes[index] = marked;
            renderResults();
            ctx.onProgressChanged?.();
        } catch (error) {
            toast(error.message, "error");
            if (error.code?.startsWith("ai_")) ctx.onAIError?.(error);
            if (button.isConnected) setBusy(button, false);
            form.querySelectorAll("input, textarea").forEach((input) => { input.readOnly = false; });
        }
    }

    /* ---------------- Results ---------------- */

    function answerText(question, response) {
        if (question.type === "multiple_choice") {
            return response?.choice === null || response?.choice === undefined ? "No answer" : question.options[response.choice];
        }
        return response?.text || "No answer";
    }

    function renderResults() {
        const quiz = state.current;
        const percent = quiz.total ? Math.round((quiz.score / quiz.total) * 100) : 0;
        const mistakes = quiz.questions.filter((_, index) => quiz.results[index].verdict !== "correct").length;
        const message = percent >= 90 ? "Excellent work — you clearly understand this." : percent >= 70 ? "Good job. Review the questions below to close the gaps." : percent >= 40 ? "A solid start. Going through your mistakes will help most." : "This topic needs more practice. Let's go through it together.";

        root.innerHTML = `
            <header class="workspace-header compact">
                <button type="button" class="link-button back-link" data-back>← All quizzes</button>
                <h1>${escapeHtml(quiz.title || quiz.topic)}</h1>
            </header>
            <section class="card result-summary">
                <div class="result-score ${percent >= 70 ? "good" : percent >= 40 ? "mid" : "low"}" role="img" aria-label="Score ${percent} percent">
                    <strong>${percent}%</strong><span>${formatScore(quiz.score)} / ${quiz.total}</span>
                </div>
                <div>
                    <h2>${escapeHtml(message)}</h2>
                    <p>${mistakes ? `You missed or partly answered ${plural(mistakes, "question")}.` : "You answered every question correctly."}</p>
                    <div class="button-row">
                        ${mistakes ? `<button type="button" class="btn btn-primary" data-explain>Explain my mistakes</button>` : ""}
                        <button type="button" class="btn btn-quiet" data-save-review>Save review to notes</button>
                        <button type="button" class="btn btn-quiet" data-again>New quiz on this topic</button>
                    </div>
                </div>
            </section>
            <ol class="review-list">
                ${quiz.questions.map((question, index) => reviewMarkup(question, quiz.responses?.[index], quiz.results[index], index)).join("")}
            </ol>`;

        root.querySelector("[data-back]").addEventListener("click", backToList);
        root.querySelector("[data-explain]")?.addEventListener("click", explainMistakes);
        root.querySelector("[data-save-review]").addEventListener("click", saveReview);
        root.querySelector("[data-again]").addEventListener("click", () => {
            state.current = null;
            show({ topic: quiz.topic });
        });
        root.scrollTop = 0;
    }

    function formatScore(score) {
        return Number.isInteger(score) ? score : score.toFixed(1);
    }

    function reviewMarkup(question, response, result, index) {
        const verdict = VERDICT[result.verdict];
        const correct = question.type === "multiple_choice" ? question.options[question.answerIndex] : question.answer;
        return `
            <li class="card review-item ${result.verdict}">
                <div class="review-head">
                    <span class="verdict-badge ${result.verdict}"><span aria-hidden="true">${verdict.icon}</span> ${verdict.label}</span>
                    <span class="question-number">Q${index + 1}</span>
                </div>
                <p class="review-question">${escapeHtml(question.question)}</p>
                <dl class="review-answers">
                    <div><dt>Your answer</dt><dd>${escapeHtml(answerText(question, response))}</dd></div>
                    ${result.verdict !== "correct" ? `<div><dt>${question.type === "multiple_choice" ? "Correct answer" : "Model answer"}</dt><dd>${escapeHtml(correct)}</dd></div>` : ""}
                </dl>
                ${result.feedback ? `<p class="review-feedback">${escapeHtml(result.feedback)}</p>` : ""}
                ${question.explanation ? `<p class="review-explanation"><b>Why:</b> ${escapeHtml(question.explanation)}</p>` : ""}
            </li>`;
    }

    function reviewText(quiz, { onlyMistakes = false } = {}) {
        return quiz.questions.map((question, index) => {
            const result = quiz.results[index];
            if (onlyMistakes && result.verdict === "correct") return null;
            const correct = question.type === "multiple_choice" ? question.options[question.answerIndex] : question.answer;
            return [
                `**Q${index + 1}. ${question.question}**`,
                question.type === "multiple_choice" ? question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("  \n") : null,
                `- My answer: ${answerText(question, quiz.responses?.[index])}`,
                `- ${question.type === "multiple_choice" ? "Correct answer" : "Model answer"}: ${correct}`,
                `- Result: ${VERDICT[result.verdict].label}${result.feedback ? ` — ${result.feedback}` : ""}`,
                question.explanation ? `- Why: ${question.explanation}` : null,
            ].filter(Boolean).join("\n");
        }).filter(Boolean).join("\n\n");
    }

    function explainMistakes() {
        const quiz = state.current;
        const message = `I just took a quiz on "${quiz.topic || quiz.title}" and scored ${formatScore(quiz.score)}/${quiz.total}. Help me understand my mistakes. For each one, explain the misconception behind my answer and how to think about it correctly, then give me one similar practice question to check I've got it.\n\n${reviewText(quiz, { onlyMistakes: true })}`;
        ctx.tutor.startWith({ message, settings: { level: quiz.level, mode: "explain" } });
    }

    async function saveReview() {
        const quiz = state.current;
        try {
            await api.post("/notes", {
                title: `Quiz review: ${quiz.title || quiz.topic}`.slice(0, 200),
                content: `## ${quiz.title || quiz.topic}\n\nScore: **${formatScore(quiz.score)} / ${quiz.total}** · ${formatDate(quiz.completedAt, { withTime: true })}\n\n${reviewText(quiz)}`,
                kind: "quiz-review",
            });
            toast("Quiz review saved to your notes.", "success");
            ctx.notes.invalidate();
        } catch (error) {
            toast(error.message, "error");
        }
    }

    function backToList() {
        state.current = null;
        state.prefill = {};
        refresh();
    }

    return {
        show,
        reset() {
            state.generating?.abort();
            state.quizzes = [];
            state.current = null;
            root.innerHTML = "";
        },
    };
}
