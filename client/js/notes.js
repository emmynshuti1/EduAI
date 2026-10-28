/* =========================================================
   NOTES VIEW
   Saved explanations, quiz reviews, plans and personal notes.
========================================================= */

import { api } from "./api.js";
import { escapeHtml, formatDate, toast, confirmDialog, renderMarkdown, previewText, emptyState, setBusy, copyText, flashButton } from "./ui.js";

const KIND_LABELS = {
    note: "Note",
    explanation: "Explanation",
    summary: "Summary",
    plan: "Study plan",
    flashcards: "Flashcards",
    "quiz-review": "Quiz review",
};

export function createNotes(ctx) {
    const root = document.getElementById("notesRoot");
    const state = { notes: [], loaded: false, openId: null, editing: false, query: "" };

    async function load({ force = false } = {}) {
        if (state.loaded && !force) return state.notes;
        const { notes } = await api.get("/notes");
        state.notes = notes;
        state.loaded = true;
        return notes;
    }

    async function show(params = {}) {
        if (params.noteId) state.openId = params.noteId;
        if (params.list) state.openId = null;
        state.editing = Boolean(params.create);
        if (params.create) state.openId = null;

        if (!state.loaded) root.innerHTML = `<div class="skeleton-list"><span></span><span></span><span></span></div>`;
        try {
            await load({ force: true });
        } catch (error) {
            toast(error.message, "error");
        }
        render();
    }

    function render() {
        if (state.editing) return renderEditor(state.notes.find((note) => note.id === state.openId) || null);
        const note = state.notes.find((item) => item.id === state.openId);
        if (note) return renderNote(note);
        state.openId = null;
        renderList();
    }

    function renderList() {
        const query = state.query.toLowerCase();
        const visible = state.notes.filter((note) => !query || `${note.title} ${note.content}`.toLowerCase().includes(query));

        root.innerHTML = `
            <header class="workspace-header">
                <div>
                    <p class="section-kicker">YOUR KNOWLEDGE</p>
                    <h1>Notes</h1>
                    <p class="workspace-lede">Explanations you saved from the tutor, quiz reviews, and your own notes, all in one place.</p>
                </div>
                <button type="button" class="btn btn-primary" data-new>New note</button>
            </header>
            ${state.notes.length ? `
                <div class="toolbar">
                    <input type="search" class="text-input" id="notesSearch" placeholder="Search notes" aria-label="Search notes" value="${escapeHtml(state.query)}" />
                </div>` : ""}
            ${!state.notes.length
                ? emptyState({ icon: "≡", title: "No notes yet", text: "Use “Save to notes” under any tutor answer, save a quiz review, or write your own note.", action: `<button type="button" class="btn btn-quiet" data-goto-tutor>Ask the tutor something</button>` })
                : visible.length
                    ? `<div class="note-grid">${visible.map((note) => `
                        <button type="button" class="card note-card" data-open="${escapeHtml(note.id)}">
                            <span class="kind-badge kind-${escapeHtml(note.kind)}">${escapeHtml(KIND_LABELS[note.kind] || "Note")}</span>
                            <b>${escapeHtml(note.title)}</b>
                            <span class="note-preview">${escapeHtml(previewText(note.content, 160))}</span>
                            <small>Updated ${escapeHtml(formatDate(note.updatedAt))}</small>
                        </button>`).join("")}</div>`
                    : `<p class="muted center">No notes match “${escapeHtml(state.query)}”.</p>`}`;

        root.querySelector("[data-new]").addEventListener("click", () => {
            state.openId = null;
            state.editing = true;
            render();
        });
        root.querySelector("[data-goto-tutor]")?.addEventListener("click", () => ctx.navigate("tutor"));
        const search = root.querySelector("#notesSearch");
        search?.addEventListener("input", () => {
            state.query = search.value;
            const position = search.selectionStart;
            renderList();
            const next = root.querySelector("#notesSearch");
            next.focus();
            next.setSelectionRange(position, position);
        });
        root.querySelector(".note-grid")?.addEventListener("click", (event) => {
            const id = event.target.closest("[data-open]")?.dataset.open;
            if (id) {
                state.openId = id;
                render();
            }
        });
    }

    function renderNote(note) {
        root.innerHTML = `
            <header class="workspace-header compact">
                <button type="button" class="link-button back-link" data-back>← All notes</button>
                <span class="kind-badge kind-${escapeHtml(note.kind)}">${escapeHtml(KIND_LABELS[note.kind] || "Note")}</span>
                <h1>${escapeHtml(note.title)}</h1>
                <p class="workspace-lede">Updated ${escapeHtml(formatDate(note.updatedAt, { withTime: true }))}</p>
                <div class="button-row">
                    <button type="button" class="btn btn-primary" data-quiz>Quiz me on this</button>
                    <button type="button" class="btn btn-quiet" data-discuss>Study with the tutor</button>
                    ${note.sourceConversationId ? `<button type="button" class="btn btn-quiet" data-source>Open original conversation</button>` : ""}
                    <button type="button" class="btn btn-quiet" data-copy>Copy</button>
                    <button type="button" class="btn btn-quiet" data-edit>Edit</button>
                    <button type="button" class="btn btn-quiet btn-danger-text" data-delete>Delete</button>
                </div>
            </header>
            <article class="card note-reader message-body markdown"></article>`;

        renderMarkdown(root.querySelector(".note-reader"), note.content);

        root.querySelector("[data-back]").addEventListener("click", () => {
            state.openId = null;
            render();
        });
        root.querySelector("[data-quiz]").addEventListener("click", () => ctx.navigate("quizzes", { noteId: note.id }));
        root.querySelector("[data-discuss]").addEventListener("click", () => {
            const excerpt = note.content.length > 8000 ? `${note.content.slice(0, 8000)}\n\n[The rest of this note was not included.]` : note.content;
            ctx.tutor.startWith({
                message: `Help me study my note "${note.title}". Start by checking what I already understand with a question, then fill in the gaps.\n\n---\n${excerpt}`,
            });
        });
        root.querySelector("[data-source]")?.addEventListener("click", () => ctx.tutor.openConversation(note.sourceConversationId));
        root.querySelector("[data-copy]").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            try {
                await copyText(note.content);
                flashButton(button, "Copied", "Copy");
            } catch {
                flashButton(button, "Copy failed", "Copy");
            }
        });
        root.querySelector("[data-edit]").addEventListener("click", () => {
            state.editing = true;
            render();
        });
        root.querySelector("[data-delete]").addEventListener("click", async () => {
            const ok = await confirmDialog({ title: "Delete this note?", message: `“${note.title}” will be permanently deleted.`, confirmLabel: "Delete", danger: true });
            if (!ok) return;
            try {
                await api.delete(`/notes/${note.id}`);
                state.notes = state.notes.filter((item) => item.id !== note.id);
                state.openId = null;
                toast("Note deleted.", "success");
                render();
            } catch (error) {
                toast(error.message, "error");
            }
        });
    }

    function renderEditor(note) {
        root.innerHTML = `
            <header class="workspace-header compact">
                <button type="button" class="link-button back-link" data-back>← ${note ? "Back to note" : "All notes"}</button>
                <h1>${note ? "Edit note" : "New note"}</h1>
            </header>
            <form class="card note-editor" id="noteEditor">
                <label class="field-block">
                    <span>Title</span>
                    <input class="text-input" name="title" maxlength="200" required value="${escapeHtml(note?.title || "")}" placeholder="e.g. Newton's laws — summary" />
                </label>
                <label class="field-block">
                    <span>Content <small>(Markdown supported)</small></span>
                    <textarea class="text-input note-textarea" name="content" rows="16" required placeholder="Write or paste your notes…">${escapeHtml(note?.content || "")}</textarea>
                </label>
                <div class="form-actions">
                    <button type="button" class="btn btn-quiet" data-cancel>Cancel</button>
                    <button type="submit" class="btn btn-primary">${note ? "Save changes" : "Create note"}</button>
                </div>
            </form>`;

        const form = root.querySelector("#noteEditor");
        const leave = () => {
            state.editing = false;
            render();
        };
        root.querySelector("[data-back]").addEventListener("click", leave);
        root.querySelector("[data-cancel]").addEventListener("click", leave);
        form.elements.title.focus();

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const submit = form.querySelector('[type="submit"]');
            const body = { title: form.elements.title.value.trim(), content: form.elements.content.value };
            setBusy(submit, true, "Saving…");
            try {
                if (note) {
                    const { note: updated } = await api.patch(`/notes/${note.id}`, body);
                    state.notes = state.notes.map((item) => (item.id === updated.id ? updated : item));
                    state.openId = updated.id;
                } else {
                    const { note: created } = await api.post("/notes", { ...body, kind: "note" });
                    state.notes.unshift(created);
                    state.openId = created.id;
                }
                state.editing = false;
                toast("Note saved.", "success");
                render();
            } catch (error) {
                toast(error.message, "error");
                setBusy(submit, false);
            }
        });
    }

    return {
        show,
        load,
        cached: () => state.notes,
        invalidate: () => { state.loaded = false; },
        reset() {
            Object.assign(state, { notes: [], loaded: false, openId: null, editing: false, query: "" });
            root.innerHTML = "";
        },
    };
}
