/* =========================================================
   EDUAI APP SHELL
   Authentication, navigation between study views, theme,
   keyboard shortcuts, and service status.
========================================================= */

import { api, setToken, hasToken, setUnauthorizedHandler, safeStorage } from "./api.js";
import { toast, escapeHtml, initials, plural, confirmDialog } from "./ui.js";
import { createTutor } from "./chat.js";
import { createQuizzes } from "./quizzes.js";
import { createNotes } from "./notes.js";
import { createMaterials } from "./materials.js";
import { createProgress } from "./progress.js";

/* Web fonts are optional: load them without blocking the page, so a slow or
   blocked font CDN never stops EduAI from opening (system fonts are used meanwhile). */
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap";
document.head.appendChild(fontLink);

const THEME_KEY = "EduAI-theme";
const LEGACY_HISTORY_KEY = "EduAI-chat-history";
const VIEW_TITLES = { tutor: null, quizzes: "Quizzes", notes: "Notes", materials: "Study materials", progress: "Progress" };

const $ = (id) => document.getElementById(id);
const dom = {
    landing: $("landingScreen"),
    app: $("appContainer"),
    authScreen: $("authScreen"),
    authForm: $("authForm"),
    authSubmit: $("authSubmitButton"),
    authError: $("authError"),
    authTitle: $("authTitle"),
    authSubtitle: $("authSubtitle"),
    authSwitchBtn: $("authSwitchBtn"),
    authSwitchPrompt: $("authSwitchPrompt"),
    authPasswordHint: $("authPasswordHint"),
    registerNameRow: $("registerNameRow"),
    registerName: $("registerName"),
    authEmail: $("authEmail"),
    authPassword: $("authPassword"),
    passwordToggle: $("passwordToggle"),
    termsRow: $("termsRow"),
    closeAuth: $("closeAuthBtn"),
    authBackdrop: document.querySelector(".auth-backdrop"),
    sidebar: $("sidebar"),
    sidebarToggle: $("sidebarToggleBtn"),
    sidebarBackdrop: $("sidebarBackdrop"),
    mobileMenu: $("mobileMenuBtn"),
    newChat: $("newChatBtn"),
    clearChat: $("clearChatBtn"),
    themeToggle: $("themeToggle"),
    exportChat: $("exportChatBtn"),
    restoreChat: $("restoreChatBtn"),
    restoreInput: $("restoreChatInput"),
    logout: $("logoutBtn"),
    accountName: $("accountName"),
    accountEmail: $("accountEmail"),
    accountInitial: $("accountInitial"),
    userBadge: $("userBadge"),
    chatTitle: $("chatTitle"),
    statusDot: $("statusDot"),
    statusText: $("headerStatusText"),
    settingsBtn: $("tutorSettingsBtn"),
    privateBadge: document.querySelector(".private-badge"),
    aiBanner: $("aiBanner"),
    aiBannerTitle: $("aiBannerTitle"),
    aiBannerText: $("aiBannerText"),
    aiBannerRetry: $("aiBannerRetry"),
    legacyBanner: $("legacyBanner"),
    legacyBannerText: $("legacyBannerText"),
    legacyImport: $("legacyImport"),
    legacyDismiss: $("legacyDismiss"),
};

const session = { user: null, view: "tutor", authMode: "login", lastFocus: null };

/* ---------------- Shared context for views ---------------- */

const ctx = {
    user: () => session.user,
    navigate,
    closeMobileSidebar,
    tutorDefaults: () => tutor.active()?.settings || { level: "high", mode: "explain" },
    onAIError: (error) => showAIBanner({ ok: false, code: error.code, message: error.message }),
    onProgressChanged: () => {},
};

const materials = createMaterials(ctx);
const notes = createNotes(ctx);
ctx.materials = materials;
ctx.notes = notes;
const tutor = createTutor(ctx);
ctx.tutor = tutor;
const quizzes = createQuizzes(ctx);
const progress = createProgress(ctx);
const views = { quizzes, notes, materials, progress };

/* ---------------- Navigation ---------------- */

function navigate(view, params = {}, { push = true } = {}) {
    if (!VIEW_TITLES.hasOwnProperty(view)) view = "tutor";
    const changed = session.view !== view;
    session.view = view;

    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.viewPanel !== view);
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
        const active = item.dataset.view === view;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
    });

    const isTutor = view === "tutor";
    dom.settingsBtn.classList.toggle("hidden", !isTutor);
    dom.privateBadge.classList.toggle("hidden", !isTutor);
    dom.clearChat.classList.toggle("hidden", !isTutor);
    if (!isTutor) {
        tutor.closeSettings();
        dom.chatTitle.textContent = VIEW_TITLES[view];
        document.title = `${VIEW_TITLES[view]} · EduAI`;
    } else {
        const active = tutor.active();
        dom.chatTitle.textContent = active?.title || "New conversation";
    }

    if (push && location.hash !== `#${view}`) history.pushState({ view }, "", `#${view}`);
    closeMobileSidebar();

    if (!isTutor) views[view].show(params);
    else if (changed) tutor.focusInput();
}

document.querySelector(".workspace-nav").addEventListener("click", (event) => {
    const link = event.target.closest(".nav-item");
    if (!link) return;
    event.preventDefault();
    navigate(link.dataset.view, { list: true });
});

document.querySelector(".app-wordmark").addEventListener("click", (event) => {
    event.preventDefault();
    navigate("tutor");
});

window.addEventListener("popstate", () => {
    if (session.user) navigate(location.hash.slice(1) || "tutor", {}, { push: false });
});

/* ---------------- Sidebar ---------------- */

const isMobile = () => window.matchMedia("(max-width: 820px)").matches;

function closeMobileSidebar() {
    dom.sidebar.classList.remove("open");
    dom.mobileMenu.setAttribute("aria-expanded", "false");
}

dom.mobileMenu.addEventListener("click", () => {
    dom.sidebar.classList.add("open");
    dom.mobileMenu.setAttribute("aria-expanded", "true");
    dom.sidebar.querySelector(".new-chat-btn")?.focus();
});

dom.sidebarBackdrop.addEventListener("click", closeMobileSidebar);

dom.sidebarToggle.addEventListener("click", () => {
    if (isMobile()) return closeMobileSidebar();
    const collapsed = dom.sidebar.classList.toggle("sidebar-collapsed");
    dom.sidebarToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
});

dom.newChat.addEventListener("click", () => tutor.startNew());
dom.clearChat.addEventListener("click", () => tutor.startNew());
dom.exportChat.addEventListener("click", () => tutor.exportActive());
dom.restoreChat.addEventListener("click", () => dom.restoreInput.click());
dom.restoreInput.addEventListener("change", () => {
    const file = dom.restoreInput.files?.[0];
    dom.restoreInput.value = "";
    if (file) tutor.importFile(file);
});

/* ---------------- Theme ---------------- */

const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 15.2A8.5 8.5 0 1 1 8.8 4a7 7 0 0 0 11.2 11.2Z"/></svg>`;
const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.7"/><path d="M12 2.5v2M12 19.5v2M4 12H2M22 12h-2M5.3 5.3 3.9 3.9m16.2 16.2-1.4-1.4M18.7 5.3l1.4-1.4M3.9 20.1l1.4-1.4"/></svg>`;

function applyTheme(theme) {
    const dark = theme !== "light";
    document.body.classList.toggle("dark-theme", dark);
    document.body.classList.toggle("light-theme", !dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#090b12" : "#fcfcfd");
    safeStorage.set(THEME_KEY, dark ? "dark" : "light");
    dom.themeToggle.innerHTML = dark ? MOON : SUN;
    dom.themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    dom.themeToggle.title = dom.themeToggle.getAttribute("aria-label");
}

dom.themeToggle.addEventListener("click", () => applyTheme(document.body.classList.contains("dark-theme") ? "light" : "dark"));

/* ---------------- Authentication ---------------- */

function setAuthMode(mode) {
    session.authMode = mode;
    const register = mode === "register";
    dom.registerNameRow.classList.toggle("hidden", !register);
    dom.termsRow.classList.toggle("hidden", !register);
    dom.registerName.required = register;
    dom.authPassword.autocomplete = register ? "new-password" : "current-password";
    dom.authPassword.minLength = register ? 8 : 0;
    dom.authPasswordHint.textContent = register ? "At least 8 characters" : "";
    dom.authTitle.textContent = register ? "Create your account" : "Welcome back";
    dom.authSubtitle.textContent = register ? "Build a learning space that grows with you." : "Continue where your curiosity left off.";
    dom.authSwitchPrompt.textContent = register ? "Already have an account?" : "New to EduAI?";
    dom.authSwitchBtn.textContent = register ? "Log in" : "Create an account";
    dom.authSubmit.innerHTML = `<span>${register ? "Create my account" : "Continue to EduAI"}</span><span aria-hidden="true">→</span>`;
    document.querySelectorAll(".auth-tab").forEach((tab) => {
        const active = tab.dataset.mode === mode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
    });
    showAuthError("");
}

function showAuthError(message) {
    dom.authError.textContent = message || "";
    dom.authError.classList.toggle("visible", Boolean(message));
}

function showAuthScreen(visible) {
    if (visible && dom.authScreen.classList.contains("hidden")) session.lastFocus = document.activeElement;
    dom.authScreen.classList.toggle("hidden", !visible);
    document.body.classList.toggle("modal-open", visible);
    if (visible) {
        requestAnimationFrame(() => (session.authMode === "register" ? dom.registerName : dom.authEmail).focus());
    } else if (session.lastFocus instanceof HTMLElement && !session.lastFocus.closest(".hidden")) {
        session.lastFocus.focus();
    }
}

function showLanding() {
    dom.landing.classList.remove("hidden");
    dom.app.classList.add("hidden");
    showAuthScreen(false);
    document.title = "EduAI — Learn anything, deeply";
}

async function submitAuth(event) {
    event.preventDefault();
    showAuthError("");
    const register = session.authMode === "register";
    const payload = { email: dom.authEmail.value.trim(), password: dom.authPassword.value };
    if (register) payload.name = dom.registerName.value.trim();

    if (!payload.email || !payload.password || (register && !payload.name)) {
        return showAuthError("Please fill in all fields.");
    }
    if (register && payload.password.length < 8) {
        return showAuthError("Use a password with at least 8 characters.");
    }

    dom.authSubmit.disabled = true;
    dom.authSubmit.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${register ? "Creating your space…" : "Signing in…"}</span>`;

    try {
        const data = await api.post(register ? "/auth/register" : "/auth/login", payload);
        setToken(data.token);
        dom.authForm.reset();
        await enterApp(data.user);
        toast(register ? `Welcome to EduAI, ${data.user.name.split(" ")[0]}!` : "Welcome back.", "success");
    } catch (error) {
        showAuthError(error.message);
    } finally {
        dom.authSubmit.disabled = false;
        setAuthMode(session.authMode);
    }
}

dom.authForm.addEventListener("submit", submitAuth);
document.querySelectorAll(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));
document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
        setAuthMode(button.dataset.authMode);
        showAuthScreen(true);
    });
});
dom.authSwitchBtn.addEventListener("click", () => setAuthMode(session.authMode === "login" ? "register" : "login"));
dom.closeAuth.addEventListener("click", () => showAuthScreen(false));
dom.authBackdrop?.addEventListener("click", () => showAuthScreen(false));
dom.passwordToggle.addEventListener("click", () => {
    const reveal = dom.authPassword.type === "password";
    dom.authPassword.type = reveal ? "text" : "password";
    dom.passwordToggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    dom.passwordToggle.setAttribute("aria-pressed", String(reveal));
    dom.passwordToggle.classList.toggle("password-visible", reveal);
});

function updateAccount(user) {
    dom.accountName.textContent = user?.name || "Your learning space";
    dom.accountEmail.textContent = user?.email || "";
    dom.accountInitial.textContent = (user?.name || "E").slice(0, 1).toUpperCase();
    dom.userBadge.textContent = user ? initials(user.name) : "";
    dom.userBadge.title = user?.name || "";
    dom.userBadge.classList.toggle("hidden", !user);
}

async function enterApp(user) {
    session.user = user;
    updateAccount(user);
    dom.landing.classList.add("hidden");
    dom.app.classList.remove("hidden");
    showAuthScreen(false);

    tutor.reset();
    const [conversations] = await Promise.all([
        tutor.loadConversations().catch((error) => {
            toast(error.message, "error");
            return [];
        }),
        materials.load().catch(() => []),
    ]);

    const requested = location.hash.slice(1);
    if (VIEW_TITLES.hasOwnProperty(requested) && requested !== "tutor") {
        tutor.startNew();
        navigate(requested, {}, { push: false });
    } else if (conversations.length) {
        await tutor.openConversation(conversations[0].id);
    } else {
        tutor.startNew();
    }

    checkStatus();
    offerLegacyImport();
}

async function logout() {
    if (tutor.isGenerating()) {
        const ok = await confirmDialog({ title: "Stop the current answer and log out?", confirmLabel: "Log out" });
        if (!ok) return;
    }
    leaveApp();
    toast("You've been logged out.", "success");
}

function leaveApp() {
    tutor.reset();
    Object.values(views).forEach((view) => view.reset());
    session.user = null;
    setToken("");
    updateAccount(null);
    dom.aiBanner.classList.add("hidden");
    dom.legacyBanner.classList.add("hidden");
    history.replaceState(null, "", location.pathname);
    showLanding();
}

dom.logout.addEventListener("click", logout);

setUnauthorizedHandler(() => {
    if (!session.user) return;
    leaveApp();
    setAuthMode("login");
    showAuthScreen(true);
    showAuthError("Your session has expired. Please log in again.");
});

/* ---------------- AI service status ---------------- */

const STATUS_HELP = {
    ai_auth: "The OpenAI API key configured on the server was rejected. Update OPENAI_API_KEY in server/.env and restart the server.",
    ai_quota: "The AI account has no remaining credits or hit its spending limit. Add credits in the provider dashboard.",
    ai_not_configured: "No AI provider is configured. Set OPENAI_API_KEY (or OPENAI_BASE_URL for a local model) in server/.env.",
    ai_model: "The AI model set in OPENAI_MODEL isn't available to this account.",
    ai_unreachable: "The server can't reach the AI provider. Check its network connection or local model server.",
};

function showAIBanner(status) {
    const ok = status?.ok;
    dom.statusDot.className = `status-dot ${ok ? "" : "offline"}`;
    dom.statusText.textContent = ok ? "EduAI Tutor · Ready" : "EduAI Tutor · AI unavailable";
    if (ok || !status) {
        dom.aiBanner.classList.add("hidden");
        return;
    }
    if (["ai_rate_limited", "ai_timeout", "ai_provider_error", "ai_empty", "ai_bad_output"].includes(status.code)) return;
    dom.aiBannerTitle.textContent = "The AI tutor can't respond right now";
    dom.aiBannerText.textContent = STATUS_HELP[status.code] || status.message || "The AI service is unavailable.";
    dom.aiBanner.classList.remove("hidden");
}

async function checkStatus(refresh = false) {
    try {
        const { ai } = await api.get(`/status${refresh ? "?refresh=1" : ""}`);
        showAIBanner(ai);
        return ai;
    } catch {
        return null;
    }
}

dom.aiBannerRetry.addEventListener("click", async () => {
    dom.aiBannerRetry.disabled = true;
    const status = await checkStatus(true);
    dom.aiBannerRetry.disabled = false;
    if (status?.ok) toast("The AI tutor is available again.", "success");
    else toast("Still unavailable. Check the server configuration.", "error");
});

/* ---------------- Conversations saved by the previous version ---------------- */

function legacyConversations() {
    try {
        const saved = JSON.parse(safeStorage.get(LEGACY_HISTORY_KEY) || "[]");
        return Array.isArray(saved)
            ? saved.filter((item) => Array.isArray(item?.messages) && item.messages.some((message) => message?.content?.trim?.()))
            : [];
    } catch {
        return [];
    }
}

function offerLegacyImport() {
    const list = legacyConversations();
    if (!list.length) {
        safeStorage.remove(LEGACY_HISTORY_KEY);
        return;
    }
    dom.legacyBannerText.textContent = `${plural(list.length, "conversation")} from an earlier version of EduAI ${list.length === 1 ? "is" : "are"} stored only in this browser. Import ${list.length === 1 ? "it" : "them"} into your account (${session.user.email}) to keep ${list.length === 1 ? "it" : "them"} safe and available everywhere.`;
    dom.legacyBanner.classList.remove("hidden");
}

dom.legacyImport.addEventListener("click", async () => {
    dom.legacyImport.disabled = true;
    try {
        const { imported } = await tutor.importConversations(legacyConversations());
        safeStorage.remove(LEGACY_HISTORY_KEY);
        dom.legacyBanner.classList.add("hidden");
        toast(`${plural(imported.length, "conversation")} imported into your account.`, "success");
    } catch (error) {
        toast(error.message, "error");
    } finally {
        dom.legacyImport.disabled = false;
    }
});

dom.legacyDismiss.addEventListener("click", () => dom.legacyBanner.classList.add("hidden"));

/* ---------------- Keyboard shortcuts ---------------- */

document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === "Escape") {
        if (document.querySelector("dialog[open]")) return;
        if (!dom.authScreen.classList.contains("hidden")) return showAuthScreen(false);
        if (tutor.settingsOpen()) {
            tutor.closeSettings();
            dom.settingsBtn.focus();
            return;
        }
        if (dom.sidebar.classList.contains("open")) return closeMobileSidebar();
        return;
    }

    if (!session.user || !mod) return;
    const key = event.key.toLowerCase();
    if (key === "k") {
        event.preventDefault();
        if (isMobile()) dom.sidebar.classList.add("open");
        $("conversationSearch").focus();
    } else if (key === "n" && !event.shiftKey) {
        // Some browsers reserve Ctrl+N for a new window; Ctrl+Alt+N always reaches the page.
        event.preventDefault();
        tutor.startNew();
    } else if (key === "/") {
        event.preventDefault();
        navigate("tutor");
        tutor.focusInput();
    }
});

/* ---------------- Start ---------------- */

async function boot() {
    applyTheme(safeStorage.get(THEME_KEY) || "dark");
    setAuthMode("login");
    safeStorage.remove("EduAI-user"); // the old version cached the profile; the server is the source of truth now

    if (!hasToken()) {
        showLanding();
        return;
    }

    dom.landing.classList.add("hidden");
    dom.app.classList.remove("hidden");
    try {
        const { user } = await api.get("/auth/me");
        await enterApp(user);
    } catch (error) {
        showLanding();
        if (error.code === "network") {
            // Keep the session so a reload signs straight back in once the server is up.
            toast(error.message, "error");
            return;
        }
        setToken("");
        if (error.status === 401) {
            setAuthMode("login");
            showAuthScreen(true);
            showAuthError("Your session has expired. Please log in again.");
        }
    }
}

boot();
