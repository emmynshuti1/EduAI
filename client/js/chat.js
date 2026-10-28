/* =========================================================
   TUTOR (CHAT) VIEW
   Conversations live on the server; this module keeps a local cache
   of the list and the open conversation, and streams answers.
========================================================= */

import { api, streamChat, safeStorage, ApiError } from "./api.js";
import {
    LEVELS, MODES, escapeHtml, formatDate, initials, toast, renderMarkdown, copyText, flashButton,
    promptDialog, confirmDialog, previewText,
} from "./ui.js";

const DEFAULTS_KEY = "EduAI-tutor-defaults";
const AI_ICON = `<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M14 3.5 16.6 11l7.9 3-7.9 3L14 24.5 11.4 17l-7.9-3 7.9-3L14 3.5Z" fill="currentColor"/></svg>`;

const QUICK_ACTIONS = [
    { label: "Explain it more simply", prompt: "Can you explain that again more simply, with an everyday example?" },
    { label: "Give me a hint", prompt: "I'm stuck. Give me a hint for the next step, but don't give me the full answer yet." },
    { label: "Practice question", prompt: "Give me one practice question on this so I can test myself. Wait for my answer before showing the solution." },
    { label: "Summarize key points", prompt: "Summarize the key points we've covered as a short revision list." },
];

const WELCOME_CARDS = [
    { icon: "✦", title: "Explain a concept", text: "Break down something difficult", prompt: "Explain step by step, with a simple example: " },
    { icon: "✓", title: "Check my answer", text: "Get feedback on your working", prompt: "Here is my answer. Is it correct? If not, show me where I went wrong.\n\nQuestion: \nMy answer: ", mode: "check" },
    { icon: "≡", title: "Summarize my notes", text: "Upload a PDF, DOCX or text file", action: "upload" },
    { icon: "◇", title: "Plan my revision", text: "A realistic plan for your deadline", prompt: "Create a realistic study plan. My exam/subject is: \nIt's on: \nI can study about __ hours a day. The topics I find hardest are: " },
    { icon: "</>", title: "Debug my code", text: "Find the root cause, not just a fix", prompt: "Help me understand why this code doesn't work. Explain the cause before the fix.\n\n```\n\n```" },
    { icon: "?", title: "Quiz me", text: "A marked quiz with feedback", action: "quiz" },
];

export function createTutor(ctx) {
    const el = {
        messages: document.getElementById("chatMessages"),
        form: document.getElementById("chatForm"),
        input: document.getElementById("messageInput"),
        send: document.getElementById("sendButton"),
        stop: document.getElementById("stopButton"),
        list: document.getElementById("conversationList"),
        search: document.getElementById("conversationSearch"),
        title: document.getElementById("chatTitle"),
        quickActions: document.getElementById("quickActions"),
        attachedRow: document.getElementById("attachedRow"),
        attach: document.getElementById("composerAttach"),
        fileInput: document.getElementById("notesUploadInput"),
        composerHint: document.getElementById("composerHint"),
        jumpLatest: document.getElementById("jumpLatest"),
        settingsBtn: document.getElementById("tutorSettingsBtn"),
        settingsLabel: document.getElementById("tutorSettingsLabel"),
        settingsPanel: document.getElementById("tutorSettings"),
        levelOptions: document.getElementById("levelOptions"),
        modeOptions: document.getElementById("modeOptions"),
        subjectInput: document.getElementById("subjectInput"),
        settingsSave: document.getElementById("tutorSettingsSave"),
        settingsCancel: document.getElementById("tutorSettingsCancel"),
    };

    const state = {
        conversations: [],
        active: null, // full conversation, or a draft { id: null, ... } before the first message
        loadingId: null,
        generation: null, // { conversationId, controller, message, element }
        stickToBottom: true,
        pendingSettings: null,
    };

    /* ---------------- Settings ---------------- */

    function loadDefaults() {
        try {
            const saved = JSON.parse(safeStorage.get(DEFAULTS_KEY) || "{}");
            return {
                level: LEVELS[saved.level] ? saved.level : "high",
                mode: MODES[saved.mode] ? saved.mode : "explain",
                subject: typeof saved.subject === "string" ? saved.subject : "",
            };
        } catch {
            return { level: "high", mode: "explain", subject: "" };
        }
    }

    function saveDefaults({ level, mode, subject }) {
        safeStorage.set(DEFAULTS_KEY, JSON.stringify({ level, mode, subject }));
    }

    function newDraft(overrides = {}) {
        return { id: null, title: "New conversation", messages: [], settings: { ...loadDefaults(), materialIds: [], ...overrides } };
    }

    function settingsLabel(settings) {
        return `${LEVELS[settings.level] || LEVELS.high} · ${(MODES[settings.mode] || MODES.explain).label}`;
    }

    function renderSettingsPanel(settings) {
        state.pendingSettings = { ...settings };
        el.levelOptions.innerHTML = Object.entries(LEVELS).map(([key, label]) => `
            <button type="button" class="pill ${key === settings.level ? "active" : ""}" data-level="${key}" aria-pressed="${key === settings.level}">${escapeHtml(label)}</button>
        `).join("");
        el.modeOptions.innerHTML = Object.entries(MODES).map(([key, mode]) => `
            <button type="button" class="mode-option ${key === settings.mode ? "active" : ""}" data-mode="${key}" aria-pressed="${key === settings.mode}">
                <b>${escapeHtml(mode.label)}</b><span>${escapeHtml(mode.description)}</span>
            </button>
        `).join("");
        el.subjectInput.value = settings.subject || "";
    }

    function toggleSettings(open = el.settingsPanel.classList.contains("hidden")) {
        if (open) renderSettingsPanel(state.active.settings);
        el.settingsPanel.classList.toggle("hidden", !open);
        el.settingsBtn.setAttribute("aria-expanded", String(open));
        if (open) el.levelOptions.querySelector(".active")?.focus();
    }

    el.settingsBtn.addEventListener("click", () => toggleSettings());
    el.settingsCancel.addEventListener("click", () => { toggleSettings(false); el.settingsBtn.focus(); });

    el.levelOptions.addEventListener("click", (event) => {
        const button = event.target.closest("[data-level]");
        if (!button) return;
        state.pendingSettings.level = button.dataset.level;
        el.levelOptions.querySelectorAll(".pill").forEach((pill) => {
            pill.classList.toggle("active", pill === button);
            pill.setAttribute("aria-pressed", String(pill === button));
        });
    });

    el.modeOptions.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mode]");
        if (!button) return;
        state.pendingSettings.mode = button.dataset.mode;
        el.modeOptions.querySelectorAll(".mode-option").forEach((option) => {
            option.classList.toggle("active", option === button);
            option.setAttribute("aria-pressed", String(option === button));
        });
    });

    el.settingsSave.addEventListener("click", async () => {
        const settings = { ...state.active.settings, ...state.pendingSettings, subject: el.subjectInput.value.trim() };
        await applySettings(settings);
        toggleSettings(false);
        el.input.focus();
    });

    document.addEventListener("click", (event) => {
        if (!el.settingsPanel.classList.contains("hidden") && !event.target.closest("#tutorSettings, #tutorSettingsBtn")) {
            toggleSettings(false);
        }
    });

    async function applySettings(settings) {
        saveDefaults(settings);
        state.active.settings = settings;
        updateHeader();
        if (state.active.id) {
            try {
                const { conversation } = await api.patch(`/conversations/${state.active.id}`, { settings });
                state.active.settings = conversation.settings;
                upsertSummary({ ...conversation });
            } catch (error) {
                toast(error.message, "error");
            }
        }
        renderAttachments();
    }

    /* ---------------- Conversation list ---------------- */

    async function loadConversations() {
        const { conversations } = await api.get("/conversations");
        state.conversations = conversations;
        renderList();
        return conversations;
    }

    function upsertSummary(summary) {
        const index = state.conversations.findIndex((item) => item.id === summary.id);
        const merged = { ...(state.conversations[index] || {}), ...summary };
        if (index === -1) state.conversations.unshift(merged);
        else state.conversations[index] = merged;
        state.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        renderList();
    }

    function renderList() {
        const query = el.search.value.trim().toLowerCase();
        const visible = state.conversations.filter((item) =>
            !query || `${item.title} ${item.preview || ""}`.toLowerCase().includes(query)
        );

        if (!visible.length) {
            el.list.innerHTML = `<div class="conversation-empty">${query ? "No conversations match your search." : "Your conversations will appear here."}</div>`;
            return;
        }

        el.list.innerHTML = visible.map((item) => `
            <div class="conversation-item ${item.id === state.active?.id ? "active" : ""}" role="listitem" data-id="${escapeHtml(item.id)}">
                <button class="conversation-main" type="button" data-action="open" ${item.id === state.active?.id ? 'aria-current="true"' : ""}>
                    <span class="conversation-title-row">
                        <span class="conversation-title">${escapeHtml(item.title || "New conversation")}</span>
                        <span class="conversation-time">${escapeHtml(formatDate(item.updatedAt))}</span>
                    </span>
                    <span class="conversation-preview">${escapeHtml(previewText(item.preview, 60) || "No messages yet")}</span>
                </button>
                <div class="conversation-tools">
                    <button type="button" data-action="rename" aria-label="Rename conversation" title="Rename">✎</button>
                    <button type="button" data-action="delete" aria-label="Delete conversation" title="Delete">×</button>
                </div>
            </div>
        `).join("");
    }

    el.search.addEventListener("input", renderList);

    el.list.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        const id = event.target.closest("[data-id]")?.dataset.id;
        if (!button || !id) return;
        if (button.dataset.action === "open") openConversation(id);
        if (button.dataset.action === "rename") renameConversation(id);
        if (button.dataset.action === "delete") deleteConversation(id);
    });

    async function renameConversation(id) {
        const item = state.conversations.find((conversation) => conversation.id === id);
        const title = await promptDialog({ title: "Rename conversation", input: item?.title || "", confirmLabel: "Rename" });
        if (!title) return;
        try {
            const { conversation } = await api.patch(`/conversations/${id}`, { title });
            upsertSummary(conversation);
            if (state.active?.id === id) {
                state.active.title = conversation.title;
                updateHeader();
            }
        } catch (error) {
            toast(error.message, "error");
        }
    }

    async function deleteConversation(id) {
        if (state.generation?.conversationId === id) {
            toast("Stop the current answer before deleting this conversation.", "error");
            return;
        }
        const item = state.conversations.find((conversation) => conversation.id === id);
        const confirmed = await confirmDialog({
            title: "Delete this conversation?",
            message: `“${item?.title || "This conversation"}” will be permanently deleted. Notes you saved from it are kept.`,
            confirmLabel: "Delete",
            danger: true,
        });
        if (!confirmed) return;

        try {
            await api.delete(`/conversations/${id}`);
            state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
            if (state.active?.id === id) startNew();
            else renderList();
            toast("Conversation deleted.", "success");
        } catch (error) {
            toast(error.message, "error");
        }
    }

    /* ---------------- Opening conversations ---------------- */

    async function openConversation(id) {
        ctx.navigate("tutor");
        if (state.active?.id === id) return;
        state.loadingId = id;
        el.messages.setAttribute("aria-busy", "true");

        try {
            const { conversation } = await api.get(`/conversations/${id}`);
            if (state.loadingId !== id) return;
            state.active = conversation;
            state.active.settings = { ...loadDefaults(), materialIds: [], ...conversation.settings };
            renderConversation();
            renderList();
            ctx.closeMobileSidebar();
        } catch (error) {
            toast(error.status === 404 ? "That conversation no longer exists." : error.message, "error");
            if (error.status === 404) {
                state.conversations = state.conversations.filter((item) => item.id !== id);
                renderList();
            }
        } finally {
            if (state.loadingId === id) state.loadingId = null;
            el.messages.setAttribute("aria-busy", "false");
        }
    }

    function startNew(overrides) {
        state.active = newDraft(overrides);
        renderConversation();
        renderList();
        ctx.navigate("tutor");
        ctx.closeMobileSidebar();
        el.input.focus();
    }

    /* Starts a fresh conversation and optionally sends a first message. */
    async function startWith({ message = "", settings = {}, send = true, focus = true } = {}) {
        if (state.generation) {
            toast("Please wait for the current answer to finish, or stop it.", "error");
            return;
        }
        startNew(settings);
        el.input.value = message;
        updateComposer();
        if (send && message) await sendMessage();
        else if (focus) el.input.focus();
    }

    function updateHeader() {
        const active = state.active;
        el.title.textContent = active?.title || "New conversation";
        el.settingsLabel.textContent = settingsLabel(active.settings);
        document.title = active?.id ? `${active.title} · EduAI` : "EduAI — Your AI study companion";
    }

    /* ---------------- Rendering messages ---------------- */

    function renderConversation() {
        const active = state.active;
        updateHeader();
        renderAttachments();
        el.messages.innerHTML = "";
        state.stickToBottom = true;

        if (!active.messages.length) {
            el.messages.innerHTML = welcomeMarkup();
        } else {
            active.messages.forEach((message) => appendMessage(message));
            const generation = state.generation;
            if (generation?.conversationId === active.id) {
                generation.element = appendMessage(generation.message, { streaming: true });
            }
        }

        renderActions();
        updateComposer();
        scrollToBottom(true);
    }

    function welcomeMarkup() {
        const firstName = (ctx.user()?.name || "").trim().split(/\s+/)[0];
        return `
            <div class="welcome" id="welcome">
                <div class="welcome-mark" aria-hidden="true">${AI_ICON}</div>
                <h1>${firstName ? `What are we learning today, ${escapeHtml(firstName)}?` : "What are you learning today?"}</h1>
                <p>Ask a question, check your work, or upload notes. EduAI adapts to your level and helps you understand — not just copy an answer.</p>
                <div class="suggestions">
                    ${WELCOME_CARDS.map((card, index) => `
                        <button class="suggestion" type="button" data-card="${index}">
                            <span class="suggestion-icon" aria-hidden="true">${escapeHtml(card.icon)}</span>
                            <div><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.text)}</span></div>
                            <span class="suggestion-arrow" aria-hidden="true">↗</span>
                        </button>`).join("")}
                </div>
                <div class="welcome-footnote"><i></i>Tutoring as: <button type="button" class="link-button" data-open-settings>${escapeHtml(settingsLabel(state.active.settings))}</button></div>
            </div>`;
    }

    el.messages.addEventListener("click", async (event) => {
        const card = event.target.closest("[data-card]");
        if (card) {
            const config = WELCOME_CARDS[Number(card.dataset.card)];
            if (config.action === "upload") return el.fileInput.click();
            if (config.action === "quiz") return ctx.navigate("quizzes");
            if (config.mode && state.active.settings.mode !== config.mode) {
                await applySettings({ ...state.active.settings, mode: config.mode });
            }
            el.input.value = config.prompt;
            updateComposer();
            el.input.focus();
            const caret = config.prompt.indexOf(": ") + 2;
            el.input.setSelectionRange(caret, caret);
            return;
        }
        if (event.target.closest("[data-open-settings]")) {
            event.stopPropagation();
            toggleSettings(true);
        }
    });

    function appendMessage(message, { streaming = false } = {}) {
        document.getElementById("welcome")?.remove();
        const node = document.createElement("article");
        node.className = `message ${message.role === "user" ? "user-message" : "ai-message"}`;

        if (message.role === "user") {
            node.innerHTML = `
                <div class="avatar user-avatar-message" aria-hidden="true">${escapeHtml(initials(ctx.user()?.name))}</div>
                <div class="message-content"><h3 class="sr-only">You said</h3><div class="message-body"></div></div>`;
            node.querySelector(".message-body").textContent = message.content;
        } else {
            node.innerHTML = `
                <div class="avatar ai-avatar" aria-hidden="true">${AI_ICON}</div>
                <div class="message-content"><h3 class="sr-only">EduAI said</h3><div class="message-body"></div></div>`;
            const body = node.querySelector(".message-body");
            if (streaming && !message.content) {
                body.innerHTML = `<div class="typing" aria-label="EduAI is thinking"><span></span><span></span><span></span></div>`;
            } else {
                renderMarkdown(body, message.content, { final: !streaming });
            }
            if (!streaming) decorateAssistant(node, message);
        }

        el.messages.appendChild(node);
        return node;
    }

    function decorateAssistant(node, message) {
        node.querySelector(".message-note")?.remove();
        node.querySelector(".message-actions")?.remove();
        const content = node.querySelector(".message-content");

        if (message.meta?.stopped || message.meta?.incomplete) {
            const note = document.createElement("p");
            note.className = "message-note";
            note.textContent = message.meta.stopped ? "You stopped this answer early." : "This answer was interrupted before it finished.";
            content.appendChild(note);
        }

        const actions = document.createElement("div");
        actions.className = "message-actions";
        actions.innerHTML = `
            <button type="button" class="message-action" data-msg-action="copy">Copy</button>
            <button type="button" class="message-action" data-msg-action="save">Save to notes</button>
            <button type="button" class="message-action regenerate-btn" data-msg-action="regenerate" hidden>Regenerate</button>`;
        content.appendChild(actions);

        actions.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-msg-action]");
            if (!button) return;
            const action = button.dataset.msgAction;
            if (action === "copy") {
                try {
                    await copyText(message.content);
                    flashButton(button, "Copied", "Copy");
                } catch {
                    flashButton(button, "Copy failed", "Copy");
                }
            }
            if (action === "save") saveToNotes(message, button);
            if (action === "regenerate") regenerate();
        });
    }

    /* Only the newest answer can be regenerated; only while idle. */
    function renderActions() {
        const nodes = el.messages.querySelectorAll(".ai-message");
        nodes.forEach((node, index) => {
            const button = node.querySelector(".regenerate-btn");
            if (button) button.hidden = Boolean(state.generation) || index !== nodes.length - 1;
        });

        const hasAnswer = state.active?.messages.some((message) => message.role === "assistant");
        el.quickActions.innerHTML = hasAnswer && !state.generation
            ? [...QUICK_ACTIONS.map((action, index) => `<button type="button" class="chip" data-quick="${index}">${escapeHtml(action.label)}</button>`),
                `<button type="button" class="chip chip-accent" data-quick="quiz">Quiz me on this</button>`].join("")
            : "";
    }

    el.quickActions.addEventListener("click", (event) => {
        const button = event.target.closest("[data-quick]");
        if (!button) return;
        if (button.dataset.quick === "quiz") {
            ctx.navigate("quizzes", { topic: state.active.settings.subject ? `${state.active.title} (${state.active.settings.subject})` : state.active.title });
            return;
        }
        el.input.value = QUICK_ACTIONS[Number(button.dataset.quick)].prompt;
        updateComposer();
        sendMessage();
    });

    async function saveToNotes(message, button) {
        const heading = (message.content.match(/^#{1,3}\s+(.+)$/m) || [])[1];
        const title = await promptDialog({
            title: "Save to notes",
            message: "Give this note a title so you can find it later.",
            input: (heading || state.active.title || "Study note").slice(0, 120),
            confirmLabel: "Save note",
        });
        if (!title) return;
        try {
            await api.post("/notes", { title, content: message.content, kind: "explanation", sourceConversationId: state.active.id });
            flashButton(button, "Saved ✓", "Save to notes");
            toast("Saved to your notes.", "success");
        } catch (error) {
            toast(error.message, "error");
        }
    }

    function showError(error, { retry = true } = {}) {
        el.messages.querySelector(".message-error")?.remove();
        const node = document.createElement("div");
        node.className = "message ai-message message-error";
        const help = {
            ai_auth: "This needs to be fixed on the server: the API key in server/.env is invalid or revoked.",
            ai_quota: "This needs to be fixed on the AI account: add credits or raise the spending limit.",
            ai_not_configured: "Set OPENAI_API_KEY (or OPENAI_BASE_URL for a local model) in server/.env and restart the server.",
            ai_unreachable: "Check that the server has internet access, or that your local model server is running.",
        }[error.code];

        node.innerHTML = `
            <div class="avatar ai-avatar" aria-hidden="true">!</div>
            <div class="message-content">
                <div class="error-message" role="alert">
                    <strong>EduAI couldn't answer</strong>
                    <p>${escapeHtml(error.message || "Something went wrong.")}</p>
                    ${help ? `<p class="error-help">${escapeHtml(help)}</p>` : ""}
                    ${retry ? `<button type="button" class="btn btn-quiet btn-sm" data-retry>Try again</button>` : ""}
                </div>
            </div>`;
        node.querySelector("[data-retry]")?.addEventListener("click", () => {
            node.remove();
            regenerate();
        });
        el.messages.appendChild(node);
        scrollToBottom(true);
    }

    /* ---------------- Sending & streaming ---------------- */

    async function ensureConversation() {
        if (state.active.id) return state.active;
        const { conversation } = await api.post("/conversations", { settings: state.active.settings });
        state.active = { ...conversation, settings: { ...state.active.settings, ...conversation.settings }, messages: state.active.messages };
        upsertSummary({ ...conversation, preview: null, messageCount: 0 });
        return state.active;
    }

    async function sendMessage() {
        const text = el.input.value.trim();
        if (!text || state.generation) return;

        el.messages.querySelector(".message-error")?.remove();
        el.input.value = "";
        updateComposer();

        let conversation;
        try {
            conversation = await ensureConversation();
        } catch (error) {
            el.input.value = text;
            updateComposer();
            toast(error.message, "error");
            return;
        }

        const userMessage = { id: null, role: "user", content: text, createdAt: Date.now() };
        conversation.messages.push(userMessage);
        appendMessage(userMessage);
        await runGeneration({ conversationId: conversation.id, message: text }, { userMessage });
    }

    async function regenerate() {
        if (state.generation || !state.active?.id) return;
        const messages = state.active.messages;
        if (messages[messages.length - 1]?.role === "assistant") {
            messages.pop();
            const nodes = el.messages.querySelectorAll(".ai-message:not(.message-error)");
            nodes[nodes.length - 1]?.remove();
        }
        el.messages.querySelector(".message-error")?.remove();
        await runGeneration({ conversationId: state.active.id, regenerate: true });
    }

    async function runGeneration(body, { userMessage = null } = {}) {
        const conversation = state.active;
        const assistant = { id: null, role: "assistant", content: "", meta: {}, createdAt: Date.now() };
        const generation = {
            conversationId: body.conversationId,
            controller: new AbortController(),
            message: assistant,
            element: null,
        };
        state.generation = generation;
        generation.element = appendMessage(assistant, { streaming: true });
        setGenerating(true);
        scrollToBottom(true);

        let frame = 0;
        const paint = () => {
            frame = 0;
            const node = generation.element;
            if (!node?.isConnected) return;
            renderMarkdown(node.querySelector(".message-body"), assistant.content, { final: false });
            scrollToBottom();
        };

        const attempt = () => streamChat(body, {
            signal: generation.controller.signal,
            onStart: (data) => {
                if (data.userMessage && userMessage) Object.assign(userMessage, data.userMessage);
                if (data.title && data.title !== conversation.title) {
                    conversation.title = data.title;
                    if (state.active === conversation) updateHeader();
                }
                upsertSummary({ id: conversation.id, title: conversation.title, updatedAt: Date.now(), preview: userMessage?.content });
            },
            onDelta: (text) => {
                assistant.content += text;
                if (!frame) frame = requestAnimationFrame(paint);
            },
        });

        try {
            let result;
            for (let tries = 0; ; tries += 1) {
                try {
                    result = await attempt();
                    break;
                } catch (error) {
                    // Right after Stop, the server may still be saving the previous answer.
                    if (error.status === 409 && tries < 4 && body.regenerate) {
                        await new Promise((resolve) => setTimeout(resolve, 400));
                        continue;
                    }
                    throw error;
                }
            }
            Object.assign(assistant, result.message);
            conversation.messages.push(assistant);
            upsertSummary({ id: conversation.id, updatedAt: Date.now(), preview: assistant.content });
        } catch (error) {
            if (error.name === "AbortError") {
                if (assistant.content.trim()) {
                    assistant.meta = { stopped: true };
                    conversation.messages.push(assistant);
                } else {
                    generation.element?.remove();
                    generation.element = null;
                }
            } else {
                if (assistant.content.trim()) {
                    assistant.meta = { incomplete: true };
                    conversation.messages.push(assistant);
                } else {
                    generation.element?.remove();
                    generation.element = null;
                }
                if (error.status === 409) {
                    toast(error.message, "error");
                } else if (state.active === conversation) {
                    showError(error instanceof ApiError ? error : new ApiError(error.message));
                } else {
                    toast(`“${conversation.title}”: ${error.message}`, "error");
                }
                if (error.code?.startsWith("ai_")) ctx.onAIError?.(error);
            }
        } finally {
            if (frame) cancelAnimationFrame(frame);
            const node = generation.element;
            if (node?.isConnected) {
                renderMarkdown(node.querySelector(".message-body"), assistant.content, { final: true });
                decorateAssistant(node, assistant);
            }
            state.generation = null;
            setGenerating(false);
            renderActions();
            if (state.active === conversation) scrollToBottom();
        }
    }

    function setGenerating(active) {
        el.stop.hidden = !active;
        el.messages.setAttribute("aria-busy", String(active));
        updateComposer();
        renderActions();
    }

    function updateComposer() {
        el.input.style.height = "auto";
        el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
        const busyElsewhere = state.generation && state.generation.conversationId !== state.active?.id;
        el.send.disabled = Boolean(state.generation) || !el.input.value.trim();
        el.stop.hidden = !state.generation || busyElsewhere;
        el.composerHint.textContent = busyElsewhere
            ? "EduAI is still answering in another conversation…"
            : "PDF, DOCX, TXT or Markdown";
    }

    el.input.addEventListener("input", updateComposer);
    el.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            sendMessage();
        }
    });
    el.form.addEventListener("submit", (event) => {
        event.preventDefault();
        sendMessage();
    });
    el.stop.addEventListener("click", () => state.generation?.controller.abort());

    /* ---------------- Scrolling ---------------- */

    function scrollToBottom(force = false) {
        if (!force && !state.stickToBottom) {
            el.jumpLatest.classList.remove("hidden");
            return;
        }
        el.messages.scrollTop = el.messages.scrollHeight;
    }

    el.messages.addEventListener("scroll", () => {
        const distance = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
        state.stickToBottom = distance < 80;
        if (state.stickToBottom) el.jumpLatest.classList.add("hidden");
    }, { passive: true });

    el.jumpLatest.addEventListener("click", () => {
        state.stickToBottom = true;
        el.jumpLatest.classList.add("hidden");
        el.messages.scrollTo({ top: el.messages.scrollHeight, behavior: "smooth" });
    });

    /* ---------------- Study material ---------------- */

    function renderAttachments() {
        const ids = state.active?.settings.materialIds || [];
        const known = ctx.materials.cached();
        const items = ids.map((id) => known.find((material) => material.id === id)).filter(Boolean);

        el.attachedRow.classList.toggle("hidden", !items.length);
        el.attachedRow.innerHTML = items.length
            ? `<span class="attached-label">Using:</span>` + items.map((material) => `
                <span class="attached-chip" title="${escapeHtml(material.truncated ? "Only the first part of this document could be stored" : "EduAI can read the extracted text of this file")}">
                    <span aria-hidden="true">📄</span>${escapeHtml(material.name)}${material.truncated ? " <em>(partial)</em>" : ""}
                    <button type="button" data-detach="${escapeHtml(material.id)}" aria-label="Stop using ${escapeHtml(material.name)}">×</button>
                </span>`).join("")
            : "";
    }

    el.attachedRow.addEventListener("click", (event) => {
        const id = event.target.closest("[data-detach]")?.dataset.detach;
        if (!id) return;
        applySettings({ ...state.active.settings, materialIds: state.active.settings.materialIds.filter((item) => item !== id) });
    });

    async function attachMaterial(material) {
        const ids = state.active.settings.materialIds || [];
        if (ids.includes(material.id)) return;
        if (ids.length >= 3) {
            toast("You can use up to 3 materials in one conversation. Remove one first.", "error");
            return;
        }
        await applySettings({ ...state.active.settings, materialIds: [...ids, material.id] });
    }

    el.attach.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", async () => {
        const file = el.fileInput.files?.[0];
        el.fileInput.value = "";
        if (!file) return;

        el.composerHint.textContent = `Reading ${file.name}…`;
        el.attach.disabled = true;
        try {
            const material = await ctx.materials.upload(file);
            await attachMaterial(material);
            toast(`${material.name} is ready. EduAI will use it in this conversation.`, "success");
            if (!el.input.value.trim()) {
                el.input.value = "Summarize the key ideas in this material, then ask me a question to check my understanding.";
                updateComposer();
            }
            el.input.focus();
        } catch (error) {
            toast(error.message, "error");
        } finally {
            el.attach.disabled = false;
            updateComposer();
        }
    });

    /* ---------------- Export / import ---------------- */

    async function exportActive() {
        if (!state.active?.id) {
            toast("Start a conversation first, then export it.", "error");
            return;
        }
        const conversation = state.active;
        const payload = {
            exportedAt: new Date().toISOString(),
            app: "EduAI",
            conversation: {
                title: conversation.title,
                settings: conversation.settings,
                createdAt: conversation.createdAt,
                updatedAt: conversation.updatedAt,
                messages: conversation.messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })),
            },
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(conversation.title || "eduai-chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "eduai-chat"}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function importConversations(list) {
        const { imported, skipped } = await api.post("/conversations/import", { conversations: list });
        imported.forEach((summary) => upsertSummary(summary));
        return { imported, skipped };
    }

    async function importFile(file) {
        try {
            const parsed = JSON.parse(await file.text());
            const list = Array.isArray(parsed) ? parsed : [parsed.conversation || parsed];
            const { imported } = await importConversations(list);
            if (!imported.length) throw new Error("No messages were found in that file.");
            await openConversation(imported[0].id);
            toast(imported.length === 1 ? "Conversation imported." : `${imported.length} conversations imported.`, "success");
        } catch (error) {
            toast(error instanceof SyntaxError ? "That file is not a valid EduAI export." : error.message, "error");
        }
    }

    return {
        el,
        loadConversations,
        openConversation,
        startNew,
        startWith,
        attachMaterial,
        exportActive,
        importFile,
        importConversations,
        renderAttachments,
        isGenerating: () => Boolean(state.generation),
        abort: () => state.generation?.controller.abort(),
        active: () => state.active,
        reset() {
            state.generation?.controller.abort();
            state.conversations = [];
            state.active = newDraft();
            el.list.innerHTML = "";
        },
        focusInput: () => el.input.focus(),
        closeSettings: () => toggleSettings(false),
        settingsOpen: () => !el.settingsPanel.classList.contains("hidden"),
    };
}
