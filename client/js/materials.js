/* =========================================================
   MATERIALS VIEW
   Uploaded study files. Students can see exactly which text EduAI
   extracted, so it is clear what the tutor can and cannot read.
========================================================= */

import { api } from "./api.js";
import { escapeHtml, formatDate, formatBytes, toast, confirmDialog, emptyState, plural } from "./ui.js";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.css,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.rs,.sql,.tex";

export function createMaterials(ctx) {
    const root = document.getElementById("materialsRoot");
    const state = { materials: [], loaded: false, preview: null, uploading: false };

    async function load({ force = false } = {}) {
        if (state.loaded && !force) return state.materials;
        const { materials } = await api.get("/materials");
        state.materials = materials;
        state.loaded = true;
        return materials;
    }

    async function upload(file) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 10 MB. Split it or upload a smaller file.`);
        const { material } = await api.upload("/materials", file);
        state.materials.unshift(material);
        if (root.isConnected && !root.closest(".hidden")) render();
        return material;
    }

    async function show() {
        state.preview = null;
        if (!state.loaded) root.innerHTML = `<div class="skeleton-list"><span></span><span></span></div>`;
        try {
            await load({ force: true });
        } catch (error) {
            toast(error.message, "error");
        }
        render();
    }

    function render() {
        if (state.preview) return renderPreview(state.preview);

        root.innerHTML = `
            <header class="workspace-header">
                <div>
                    <p class="section-kicker">YOUR SOURCES</p>
                    <h1>Study materials</h1>
                    <p class="workspace-lede">Upload notes, handouts or textbook chapters. EduAI extracts the text so the tutor can summarize them, answer questions about them and quiz you on them.</p>
                </div>
            </header>

            <label class="dropzone ${state.uploading ? "busy" : ""}" id="dropzone">
                <input type="file" id="materialInput" accept="${ACCEPT}" class="sr-only" ${state.uploading ? "disabled" : ""} />
                <span class="dropzone-icon" aria-hidden="true">↥</span>
                <b>${state.uploading ? "Reading your file…" : "Drop a file here or click to upload"}</b>
                <small>PDF, Word (.docx), text, Markdown or code · up to 10 MB. Scanned images and diagrams can't be read yet.</small>
            </label>

            <section class="workspace-section">
                <h2>${state.materials.length ? plural(state.materials.length, "material") : "Your materials"}</h2>
                ${state.materials.length ? `<ul class="item-list">${state.materials.map(materialRow).join("")}</ul>`
                    : emptyState({ icon: "◇", title: "Nothing uploaded yet", text: "Upload your first file above to summarize it, ask questions, or generate a quiz from it." })}
            </section>`;

        const input = root.querySelector("#materialInput");
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) handleUpload(file);
        });

        const dropzone = root.querySelector("#dropzone");
        ["dragenter", "dragover"].forEach((type) => dropzone.addEventListener(type, (event) => {
            event.preventDefault();
            dropzone.classList.add("dragging");
        }));
        ["dragleave", "drop"].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove("dragging")));
        dropzone.addEventListener("drop", (event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (file) handleUpload(file);
        });

        root.querySelector(".item-list")?.addEventListener("click", onAction);
    }

    function materialRow(material) {
        return `
            <li class="list-row material-row" data-id="${escapeHtml(material.id)}">
                <div class="list-row-main static">
                    <span class="file-badge" aria-hidden="true">${escapeHtml((material.name.split(".").pop() || "file").slice(0, 4).toUpperCase())}</span>
                    <span class="list-row-text">
                        <b>${escapeHtml(material.name)}</b>
                        <small>${escapeHtml([formatBytes(material.sizeBytes), `${material.charCount.toLocaleString()} characters of text`, `Added ${formatDate(material.createdAt)}`].join(" · "))}${material.truncated ? ` · <em class="warn">Very long: only the first part is used</em>` : ""}</small>
                    </span>
                </div>
                <div class="row-actions">
                    <button type="button" class="btn btn-quiet btn-sm" data-action="summarize">Summarize</button>
                    <button type="button" class="btn btn-quiet btn-sm" data-action="ask">Ask about it</button>
                    <button type="button" class="btn btn-quiet btn-sm" data-action="quiz">Quiz me</button>
                    <button type="button" class="btn btn-quiet btn-sm" data-action="preview">View text</button>
                    <button type="button" class="icon-button row-delete" data-action="delete" aria-label="Delete ${escapeHtml(material.name)}" title="Delete">×</button>
                </div>
            </li>`;
    }

    async function handleUpload(file) {
        if (state.uploading) return;
        state.uploading = true;
        render();
        try {
            const material = await upload(file);
            toast(`${material.name} uploaded. ${material.charCount.toLocaleString()} characters of text extracted.`, "success");
        } catch (error) {
            toast(error.message, "error");
        } finally {
            state.uploading = false;
            render();
        }
    }

    async function onAction(event) {
        const button = event.target.closest("[data-action]");
        const id = event.target.closest("[data-id]")?.dataset.id;
        const material = state.materials.find((item) => item.id === id);
        if (!button || !material) return;

        const settings = { materialIds: [material.id] };
        switch (button.dataset.action) {
            case "summarize":
                ctx.tutor.startWith({
                    message: `Summarize "${material.name}" for me: the main ideas, key terms with short definitions, and anything that is likely to come up in an exam. Then ask me one question to check my understanding.`,
                    settings: { ...settings, mode: "revise" },
                });
                break;
            case "ask":
                ctx.tutor.startWith({ settings, send: false });
                toast(`Ask anything about ${material.name}.`, "info");
                break;
            case "quiz":
                ctx.navigate("quizzes", { materialId: material.id });
                break;
            case "preview":
                await openPreview(material);
                break;
            case "delete": {
                const ok = await confirmDialog({
                    title: "Delete this material?",
                    message: `“${material.name}” and its extracted text will be deleted. Conversations that used it will no longer see it.`,
                    confirmLabel: "Delete",
                    danger: true,
                });
                if (!ok) return;
                try {
                    await api.delete(`/materials/${material.id}`);
                    state.materials = state.materials.filter((item) => item.id !== material.id);
                    ctx.tutor.renderAttachments();
                    render();
                } catch (error) {
                    toast(error.message, "error");
                }
                break;
            }
        }
    }

    async function openPreview(material) {
        try {
            const { material: full } = await api.get(`/materials/${material.id}`);
            state.preview = full;
            render();
        } catch (error) {
            toast(error.message, "error");
        }
    }

    function renderPreview(material) {
        root.innerHTML = `
            <header class="workspace-header compact">
                <button type="button" class="link-button back-link" data-back>← All materials</button>
                <h1>${escapeHtml(material.name)}</h1>
                <p class="workspace-lede">This is the exact text EduAI extracted and can use. Images, diagrams and layout are not included.${material.truncated ? " This file was very long, so only this first part was stored." : ""}</p>
            </header>
            <pre class="card extracted-text"></pre>`;
        root.querySelector(".extracted-text").textContent = material.content;
        root.querySelector("[data-back]").addEventListener("click", () => {
            state.preview = null;
            render();
        });
    }

    return {
        show,
        load,
        upload,
        cached: () => state.materials,
        reset() {
            Object.assign(state, { materials: [], loaded: false, preview: null, uploading: false });
            root.innerHTML = "";
        },
    };
}
