/* =========================================================
   SHARED UI HELPERS
========================================================= */

export const LEVELS = {
    primary: "Primary school",
    middle: "Middle school",
    high: "High school",
    university: "University",
    professional: "Adult learner",
};

export const MODES = {
    explain: { label: "Explain", description: "Clear step-by-step explanations with examples." },
    guided: { label: "Guided", description: "Hints and questions so you work it out yourself." },
    practice: { label: "Practice", description: "One problem at a time with feedback on your answer." },
    check: { label: "Check my work", description: "Feedback on your answer, essay or code." },
    revise: { label: "Exam revision", description: "Key points, common traps and recall questions." },
};

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function formatDate(timestamp, { withTime = false } = {}) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    const options = { month: "short", day: "numeric" };
    if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
    if (withTime) Object.assign(options, { hour: "numeric", minute: "2-digit" });
    return date.toLocaleDateString([], options);
}

export function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function initials(name) {
    return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "YOU";
}

/* ---------------- Toasts ---------------- */

export function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    const item = document.createElement("div");
    item.className = `status-toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    requestAnimationFrame(() => item.classList.add("visible"));

    setTimeout(() => {
        item.classList.remove("visible");
        setTimeout(() => item.remove(), 250);
    }, type === "error" ? 5000 : 2600);
}

/* ---------------- Dialog (confirm / prompt) ---------------- */

const dialog = document.getElementById("appDialog");
const dialogForm = document.getElementById("appDialogForm");
const dialogTitle = document.getElementById("appDialogTitle");
const dialogMessage = document.getElementById("appDialogMessage");
const dialogInput = document.getElementById("appDialogInput");
const dialogConfirm = document.getElementById("appDialogConfirm");
const dialogCancel = document.getElementById("appDialogCancel");

export function openDialog({ title, message = "", input = null, confirmLabel = "OK", danger = false }) {
    return new Promise((resolve) => {
        dialogTitle.textContent = title;
        dialogMessage.textContent = message;
        dialogMessage.hidden = !message;
        dialogInput.classList.toggle("hidden", input === null);
        dialogInput.value = input ?? "";
        dialogConfirm.textContent = confirmLabel;
        dialogConfirm.classList.toggle("btn-danger", danger);

        const finish = (value) => {
            dialogForm.removeEventListener("submit", onSubmit);
            dialogCancel.removeEventListener("click", onCancel);
            dialog.removeEventListener("cancel", onCancel);
            if (dialog.open) dialog.close();
            resolve(value);
        };
        const onSubmit = (event) => {
            event.preventDefault();
            if (input !== null) {
                const value = dialogInput.value.trim();
                if (!value) return dialogInput.focus();
                finish(value);
            } else {
                finish(true);
            }
        };
        const onCancel = (event) => {
            event?.preventDefault();
            finish(input !== null ? null : false);
        };

        dialogForm.addEventListener("submit", onSubmit);
        dialogCancel.addEventListener("click", onCancel);
        dialog.addEventListener("cancel", onCancel);
        dialog.showModal();
        (input !== null ? dialogInput : dialogConfirm).focus();
        if (input !== null) dialogInput.select();
    });
}

export const confirmDialog = (options) => openDialog(options);
export const promptDialog = (options) => openDialog({ input: "", ...options });

/* ---------------- Clipboard ---------------- */

export async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    try {
        document.execCommand("copy");
    } finally {
        temp.remove();
    }
}

export function flashButton(button, label, original = button.textContent) {
    button.textContent = label;
    clearTimeout(button._flashTimer);
    button._flashTimer = setTimeout(() => { button.textContent = original; }, 1500);
}

/* ---------------- Markdown ---------------- */

const markdownReady = typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined";

if (markdownReady) {
    window.marked.setOptions({ gfm: true, breaks: true });
    window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A" && node.getAttribute("href")) {
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer");
        }
    });
}

/*
 * Renders untrusted Markdown (AI output, notes) safely.
 * Without the libraries it falls back to plain text rather than raw HTML.
 */
export function renderMarkdown(container, text, { final = true } = {}) {
    if (!markdownReady) {
        container.textContent = text;
        container.classList.add("plain-text");
        return;
    }

    container.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text || ""), {
        FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe"],
        FORBID_ATTR: ["style"],
    });

    if (final) enhanceCodeBlocks(container);
}

function enhanceCodeBlocks(container) {
    container.querySelectorAll("pre > code").forEach((code) => {
        const pre = code.parentElement;
        if (pre.dataset.enhanced) return;
        pre.dataset.enhanced = "true";

        const language = (code.className.match(/language-([\w+#-]+)/) || [])[1] || "";
        if (window.hljs) {
            try {
                if (language && window.hljs.getLanguage(language)) window.hljs.highlightElement(code);
                else if (!language) {
                    const result = window.hljs.highlightAuto(code.textContent);
                    if (result.relevance > 4) {
                        code.innerHTML = result.value;
                        code.classList.add("hljs");
                    }
                }
            } catch { /* leave unhighlighted */ }
        }

        const bar = document.createElement("div");
        bar.className = "code-toolbar";
        bar.innerHTML = `<span>${escapeHtml(language || "code")}</span><button type="button" class="code-copy-button">Copy</button>`;
        bar.querySelector("button").addEventListener("click", async (event) => {
            try {
                await copyText(code.textContent || "");
                flashButton(event.currentTarget, "Copied", "Copy");
            } catch {
                flashButton(event.currentTarget, "Copy failed", "Copy");
            }
        });
        pre.prepend(bar);
    });
}

/* Strips Markdown to a short plain-text preview. */
export function previewText(text, length = 120) {
    const plain = String(text || "")
        .replace(/```[\s\S]*?```/g, " [code] ")
        .replace(/[#>*_`~|-]+/g, " ")
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
    return plain.length > length ? `${plain.slice(0, length - 1)}…` : plain;
}

export function setBusy(button, busy, busyLabel) {
    if (busy) {
        button.dataset.label = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
    } else {
        button.disabled = false;
        if (button.dataset.label) button.innerHTML = button.dataset.label;
    }
}

export function emptyState({ icon = "✦", title, text, action = "" }) {
    return `
        <div class="empty-state">
            <div class="empty-icon" aria-hidden="true">${icon}</div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(text)}</p>
            ${action}
        </div>`;
}
