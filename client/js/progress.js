/* =========================================================
   PROGRESS VIEW
   Built only from the student's own stored activity.
========================================================= */

import { api } from "./api.js";
import { escapeHtml, formatDate, toast, emptyState } from "./ui.js";

export function createProgress(ctx) {
    const root = document.getElementById("progressRoot");

    async function show() {
        root.innerHTML = `<div class="skeleton-list"><span></span><span></span><span></span></div>`;
        let stats;
        try {
            ({ stats } = await api.get("/users/stats"));
        } catch (error) {
            toast(error.message, "error");
            root.innerHTML = emptyState({ icon: "!", title: "Progress couldn't load", text: error.message });
            return;
        }
        render(stats);
    }

    function render(stats) {
        const tiles = [
            ["Conversations", stats.conversations],
            ["Questions asked", stats.questionsAsked],
            ["Quizzes completed", stats.quizzesCompleted],
            ["Average quiz score", stats.averageScore === null ? "—" : `${stats.averageScore}%`],
            ["Saved notes", stats.notes],
            ["Study materials", stats.materials],
        ];

        root.innerHTML = `
            <header class="workspace-header">
                <div>
                    <p class="section-kicker">YOUR LEARNING</p>
                    <h1>Progress</h1>
                    <p class="workspace-lede">A summary of your study activity and quiz results, so you know what to review next.</p>
                </div>
            </header>

            <div class="stat-grid">
                ${tiles.map(([label, value]) => `<div class="card stat-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
            </div>

            <div class="progress-columns">
                <section class="card">
                    <h2>Worth reviewing</h2>
                    ${stats.toReview.length ? `
                        <p class="muted">Your latest quiz on these topics scored under 70%.</p>
                        <ul class="review-topics">${stats.toReview.map((item) => `
                            <li>
                                <span><b>${escapeHtml(item.topic)}</b><small>${item.percent}% last time</small></span>
                                <span class="button-row">
                                    <button type="button" class="btn btn-quiet btn-sm" data-review="${escapeHtml(item.quizId)}">See mistakes</button>
                                    <button type="button" class="btn btn-primary btn-sm" data-practice="${escapeHtml(item.topic)}">Practice again</button>
                                </span>
                            </li>`).join("")}</ul>`
                        : `<p class="muted">${stats.quizzesCompleted ? "Nothing urgent. Every topic you've been quizzed on is at 70% or above." : "Take a quiz and topics that need more work will show up here."}</p>`}
                </section>

                <section class="card">
                    <h2>Recent quiz results</h2>
                    ${stats.recent.length ? `<ul class="result-bars">${stats.recent.map((quiz) => {
                        const percent = quiz.total ? Math.round((quiz.score / quiz.total) * 100) : 0;
                        return `
                            <li>
                                <button type="button" class="result-bar-row" data-review="${escapeHtml(quiz.id)}">
                                    <span class="result-bar-label"><b>${escapeHtml(quiz.topic)}</b><small>${escapeHtml(formatDate(quiz.completedAt))}</small></span>
                                    <span class="result-bar" role="img" aria-label="${percent} percent"><i class="${percent >= 70 ? "good" : percent >= 40 ? "mid" : "low"}" style="width:${Math.max(percent, 3)}%"></i></span>
                                    <span class="result-bar-value">${percent}%</span>
                                </button>
                            </li>`;
                    }).join("")}</ul>`
                        : `<p class="muted">No completed quizzes yet.</p><button type="button" class="btn btn-quiet" data-goto-quizzes>Create a quiz</button>`}
                </section>
            </div>`;
    }

    root.addEventListener("click", (event) => {
        const review = event.target.closest("[data-review]")?.dataset.review;
        const practice = event.target.closest("[data-practice]")?.dataset.practice;
        if (review) ctx.navigate("quizzes", { quizId: review });
        else if (practice) ctx.navigate("quizzes", { topic: practice });
        else if (event.target.closest("[data-goto-quizzes]")) ctx.navigate("quizzes");
    });

    return {
        show,
        reset() {
            root.innerHTML = "";
        },
    };
}
