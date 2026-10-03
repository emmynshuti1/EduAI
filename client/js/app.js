const API_URL =
    (window.location.origin && window.location.origin !== "null"
        ? `${window.location.origin}/api`
        : "http://localhost:5000/api");


/* =========================================================
   DOM ELEMENTS
========================================================= */

const chatForm =
    document.getElementById("chatForm");

const messageInput =
    document.getElementById("messageInput");

const chatMessages =
    document.getElementById("chatMessages");

const sendButton =
    document.getElementById("sendButton");

const stopButton =
    document.getElementById("stopButton");

const newChatBtn =
    document.getElementById("newChatBtn");

const clearChatBtn =
    document.getElementById("clearChatBtn");

const mobileMenuBtn =
    document.getElementById("mobileMenuBtn");

const sidebar =
    document.getElementById("sidebar");

const conversationList =
    document.getElementById("conversationList");

const conversationSearch =
    document.getElementById("conversationSearch");

const themeToggle =
    document.getElementById("themeToggle");

const sidebarToggleBtn =
    document.getElementById("sidebarToggleBtn");

const exportChatBtn =
    document.getElementById("exportChatBtn");

const restoreChatBtn =
    document.getElementById("restoreChatBtn");

const restoreChatInput =
    document.getElementById("restoreChatInput");

const authScreen =
    document.getElementById("authScreen");

const authForm =
    document.getElementById("authForm");

const authSubmitButton =
    document.getElementById("authSubmitButton");

const authError =
    document.getElementById("authError");

const registerNameRow =
    document.getElementById("registerNameRow");

const authEmail =
    document.getElementById("authEmail");

const authPassword =
    document.getElementById("authPassword");

const registerName =
    document.getElementById("registerName");

const userBadge =
    document.getElementById("userBadge");

const logoutBtn =
    document.getElementById("logoutBtn");

const authTabs =
    document.querySelectorAll(".auth-tab");

const landingScreen = document.getElementById("landingScreen");
const closeAuthBtn = document.getElementById("closeAuthBtn");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authSwitchBtn = document.getElementById("authSwitchBtn");
const authSwitchPrompt = document.getElementById("authSwitchPrompt");
const termsRow = document.getElementById("termsRow");
const termsCheckbox = termsRow.querySelector('input[type="checkbox"]');
const passwordToggle = document.getElementById("passwordToggle");
const authPasswordHint = document.getElementById("authPasswordHint");
const accountName = document.getElementById("accountName");
const accountInitial = document.getElementById("accountInitial");
const chatTitle = document.getElementById("chatTitle");
const composerAttach = document.getElementById("composerAttach");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const authBackdrop = document.querySelector(".auth-backdrop");

const notesUploadInput =
    document.getElementById("notesUploadInput");

const uploadNotesBtn =
    document.getElementById("uploadNotesBtn");

const uploadedNotesMeta =
    document.getElementById("uploadedNotesMeta");

const STORAGE_KEY =
    "EduAI-chat-history";

const THEME_KEY =
    "EduAI-theme";


/* =========================================================
   STATE
========================================================= */

let previousResponseId = null;

let lastUserMessage = "";

let lastUserParentResponseId = null;

let isGenerating = false;

let currentController = null;

let conversations =
    loadConversations();

let currentConversationId = null;

let sidebarCollapsed = false;

let authMode = "login";

let authToken = localStorage.getItem("EduAI-auth-token") || "";

let currentUser = JSON.parse(localStorage.getItem("EduAI-user") || "null");

let lastFocusedElement = null;


/* =========================================================
   INPUT
========================================================= */

conversationSearch.addEventListener(
    "input",
    renderConversationList
);


themeToggle.addEventListener(
    "click",
    function () {
        const nextTheme =
            document.body.classList.contains(
                "dark-theme"
            ) ?
                "light" :
                "dark";

        applyTheme(nextTheme);
    }
);


messageInput.addEventListener(
    "input",
    updateComposer
);

function setAuthMode(mode) {
    authMode = mode;
    const isRegister = mode === "register";
    registerNameRow.classList.toggle("hidden", !isRegister);
    authSubmitButton.innerHTML = `
        <span>${isRegister ? "Create my account" : "Continue to EduAI"}</span>
        <span aria-hidden="true">→</span>
    `;
    authTitle.textContent = isRegister ? "Create your account" : "Welcome back";
    authSubtitle.textContent = isRegister
        ? "Build a learning space that grows with you."
        : "Continue where your curiosity left off.";
    authSwitchPrompt.textContent = isRegister ? "Already have an account?" : "New to EduAI?";
    authSwitchBtn.textContent = isRegister ? "Log in" : "Create an account";
    termsRow.classList.toggle("hidden", !isRegister);
    termsCheckbox.required = isRegister;
    registerName.required = isRegister;
    authPassword.autocomplete = isRegister ? "new-password" : "current-password";
    authPasswordHint.textContent = isRegister ? "6+ characters" : "Secure sign in";
    authTabs.forEach((tab) => {
        const isActive = tab.dataset.mode === mode;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
    });
}

function showAuthError(message) {
    authError.textContent = message || "";
    authError.classList.toggle("visible", !!message);
}

function storeAuthSession(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem("EduAI-auth-token", token || "");
    localStorage.setItem("EduAI-user", JSON.stringify(user || null));
    updateUserBadge();
}

function clearAuthSession() {
    authToken = "";
    currentUser = null;
    localStorage.removeItem("EduAI-auth-token");
    localStorage.removeItem("EduAI-user");
    updateUserBadge();
}

function updateUserBadge() {
    if (currentUser?.name) {
        userBadge.textContent = currentUser.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase();
        userBadge.title = currentUser.name;
        userBadge.classList.remove("hidden");
        accountName.textContent = currentUser.name;
        accountInitial.textContent = currentUser.name.slice(0, 1).toUpperCase();
    } else {
        userBadge.textContent = "";
        userBadge.classList.add("hidden");
        accountName.textContent = "Your learning space";
        accountInitial.textContent = "E";
    }
}

async function submitAuthForm(event) {
    event.preventDefault();
    showAuthError("");

    const payload = {
        email: authEmail.value.trim(),
        password: authPassword.value,
    };

    if (authMode === "register") {
        payload.name = registerName.value.trim();
    }

    if (!payload.email || !payload.password || (authMode === "register" && !payload.name)) {
        showAuthError("Please complete all required fields.");
        return;
    }

    authSubmitButton.disabled = true;
    authSubmitButton.innerHTML = `
        <span>${authMode === "register" ? "Creating your space..." : "Opening your space..."}</span>
        <span aria-hidden="true">···</span>
    `;

    try {
        const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
        const response = await fetch(`${API_URL.replace("/api", "")}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || data.message || "Authentication failed.");
        }

        storeAuthSession(data.token, data.user);
        authForm.reset();
        showApp();
        showStatusToast(authMode === "register" ? "Account created." : "Logged in successfully.", "success");
    } catch (error) {
        const message = error instanceof Error && error.message
            ? error.message
            : "Unable to authenticate.";

        if (String(message).toLowerCase().includes("fetch") || String(message).toLowerCase().includes("failed to fetch") || String(message).toLowerCase().includes("connection refused") || String(message).toLowerCase().includes("network")) {
            showAuthError("The backend is not running. Start it with 'cd server && npm start', then try again.");
            showStatusToast("Backend unavailable. Start the server and try again.", "error");
            return;
        }

        showAuthError(message);
        showStatusToast(message, "error");
    } finally {
        authSubmitButton.disabled = false;
        authSubmitButton.innerHTML = `
            <span>${authMode === "register" ? "Create my account" : "Continue to EduAI"}</span>
            <span aria-hidden="true">→</span>
        `;
    }
}

function showAuthScreen(visible) {
    const wasHidden = authScreen.classList.contains("hidden");

    if (visible && wasHidden) {
        lastFocusedElement = document.activeElement;
    }

    authScreen.classList.toggle("hidden", !visible);
    document.getElementById("appContainer").classList.toggle("blurred", visible);
    document.body.classList.toggle("modal-open", visible);

    if (visible) {
        requestAnimationFrame(() => {
            (authMode === "register" ? registerName : authEmail).focus();
        });
    } else if (lastFocusedElement instanceof HTMLElement && !lastFocusedElement.closest(".hidden")) {
        lastFocusedElement.focus();
        lastFocusedElement = null;
    }
}

function showApp() {
    landingScreen.classList.add("hidden");
    document.getElementById("appContainer").classList.remove("hidden");
    showAuthScreen(false);
    messageInput.focus();
}

function showLanding() {
    landingScreen.classList.remove("hidden");
    document.getElementById("appContainer").classList.add("hidden");
    showAuthScreen(false);
}

async function loadCurrentUser() {
    if (!authToken) {
        showAuthScreen(true);
        return;
    }

    try {
        const response = await fetch(`${API_URL.replace("/api", "")}/api/auth/me`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        if (!response.ok) {
            clearAuthSession();
            showAuthScreen(true);
            return;
        }

        const data = await response.json();
        if (data.success && data.user) {
            currentUser = data.user;
            storeAuthSession(authToken, data.user);
            showApp();
            return;
        }

        clearAuthSession();
        showAuthScreen(true);
    } catch (error) {
        console.warn("Profile check failed:", error);
        clearAuthSession();
        showAuthScreen(true);
    }
}

function loadConversations() {
    try {
        const saved =
            JSON.parse(
                localStorage.getItem(
                    STORAGE_KEY
                ) || "[]"
            );

        return Array.isArray(saved) ? saved : [];
    } catch {
        return [];
    }
}


function saveConversations() {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(conversations)
    );
}


function applyTheme(themeName) {
    const theme =
        themeName ||
        localStorage.getItem(THEME_KEY) ||
        "dark";

    document.body.classList.toggle(
        "dark-theme",
        theme === "dark"
    );

    document.body.classList.toggle(
        "light-theme",
        theme === "light"
    );

    localStorage.setItem(
        THEME_KEY,
        theme
    );

    themeToggle.innerHTML = theme === "dark"
        ? `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M20 15.2A8.5 8.5 0 1 1 8.8 4a7 7 0 0 0 11.2 11.2Z" />
            </svg>
        `
        : `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="3.7" />
                <path d="M12 2.5v2M12 19.5v2M4 12H2M22 12h-2M5.3 5.3 3.9 3.9m16.2 16.2-1.4-1.4M18.7 5.3l1.4-1.4M3.9 20.1l1.4-1.4" />
            </svg>
        `;
    themeToggle.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
}


function getActiveConversation() {
    return conversations.find(
        (conversation) =>
            conversation.id === currentConversationId
    ) || null;
}


function createConversation(title = "New chat") {
    const conversation = {
        id:
            typeof crypto !== "undefined" &&
            crypto.randomUUID
                ? crypto.randomUUID()
                : String(Date.now() + Math.random()),
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
    };

    conversations.unshift(conversation);
    currentConversationId = conversation.id;
    saveConversations();
    renderConversationList();
    return conversation;
}


function ensureActiveConversation() {
    if (!currentConversationId) {
        const conversation =
            createConversation("New chat");

        return conversation;
    }

    const active = getActiveConversation();

    if (!active) {
        const conversation =
            createConversation("New chat");

        return conversation;
    }

    return active;
}


function updateConversationTitleFromMessage(messageText) {
    const active = getActiveConversation();

    if (!active || active.messages.length > 0) {
        return;
    }

    const title =
        messageText
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 32) ||
        "New chat";

    active.title = title;
    active.updatedAt = Date.now();
    saveConversations();
    renderConversationList();
}


function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay =
        date.toDateString() === now.toDateString();

    if (sameDay) {
        return date.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    return date.toLocaleDateString([], {
        month: "short",
        day: "numeric"
    });
}


function getSortedConversations() {
    return [...conversations].sort(
        (a, b) =>
            (b.updatedAt || 0) - (a.updatedAt || 0)
    );
}


function renderConversationList() {
    const query =
        conversationSearch.value.trim().toLowerCase();

    const visible =
        getSortedConversations().filter(
            (conversation) => {
                if (!query) {
                    return true;
                }

                const haystack =
                    [
                        conversation.title,
                        ...(conversation.messages || []).map(
                            (message) => message.content
                        )
                    ]
                        .join(" ")
                        .toLowerCase();

                return haystack.includes(query);
            }
        );

    if (!visible.length) {
        conversationList.innerHTML = `
            <div class="conversation-empty">
                No conversations found
            </div>
        `;
        return;
    }

    conversationList.innerHTML = "";

    visible.forEach(
        (conversation) => {
            const item =
                document.createElement("div");

            item.className =
                "conversation-item" +
                (conversation.id === currentConversationId ? " active" : "");

            const preview =
                conversation.messages?.length ?
                    conversation.messages
                        .filter(
                            (message) =>
                                message.content &&
                                message.content.trim()
                        )
                        .slice(-1)[0]?.content ||
                    "No messages yet" :
                    "No messages yet";

            const summary =
                preview
                    .replace(/<[^>]*>/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

            item.innerHTML = `
                <button
                    class="conversation-main"
                    type="button"
                    data-id="${conversation.id}"
                >
                    <span class="conversation-title-row">
                        <span class="conversation-title">
                            ${escapeHtml(
                                conversation.title || "New chat"
                            )}
                        </span>
                        <span class="conversation-time">
                            ${formatTimestamp(
                                conversation.updatedAt || Date.now()
                            )}
                        </span>
                    </span>
                    <span class="conversation-preview">
                        ${escapeHtml(
                            summary
                                ? summary.slice(0, 40) +
                                  (summary.length > 40 ? "…" : "")
                                : "No messages yet"
                        )}
                    </span>
                </button>

                <div class="conversation-tools">
                    <button
                        type="button"
                        class="rename-btn"
                        data-id="${conversation.id}"
                        aria-label="Rename conversation"
                    >
                        ✎
                    </button>
                    <button
                        type="button"
                        class="delete-btn"
                        data-id="${conversation.id}"
                        aria-label="Delete conversation"
                    >
                        ×
                    </button>
                </div>
            `;

            item
                .querySelector(".conversation-main")
                .addEventListener(
                    "click",
                    function () {
                        setCurrentConversation(
                            conversation.id
                        );
                    }
                );

            item
                .querySelector(".rename-btn")
                .addEventListener(
                    "click",
                    function (event) {
                        event.stopPropagation();
                        renameConversation(conversation.id);
                    }
                );

            item
                .querySelector(".delete-btn")
                .addEventListener(
                    "click",
                    function (event) {
                        event.stopPropagation();
                        deleteConversation(conversation.id);
                    }
                );

            conversationList.appendChild(item);
        }
    );
}


function setCurrentConversation(id) {
    currentConversationId = id;
    chatTitle.textContent = getActiveConversation()?.title || "New conversation";
    renderConversationList();
    renderConversationMessages();

    if (window.innerWidth <= 820) {
        sidebar.classList.remove("open");
        mobileMenuBtn.setAttribute("aria-expanded", "false");
    }
}


function renameConversation(id) {
    const target = conversations.find(
        (conversation) => conversation.id === id
    );

    if (!target) {
        return;
    }

    const nextTitle =
        window.prompt(
            "Rename conversation",
            target.title || "New chat"
        );

    if (nextTitle === null) {
        return;
    }

    const sanitized =
        nextTitle.trim() || "New chat";

    target.title = sanitized;
    target.updatedAt = Date.now();
    saveConversations();
    renderConversationList();

    if (target.id === currentConversationId) {
        renderConversationMessages();
    }
}


function deleteConversation(id) {
    const targetIndex = conversations.findIndex(
        (conversation) => conversation.id === id
    );

    if (targetIndex === -1) {
        return;
    }

    conversations.splice(targetIndex, 1);

    if (conversations.length === 0) {
        currentConversationId = null;
        saveConversations();
        renderConversationList();
        renderConversationMessages();
        return;
    }

    if (currentConversationId === id) {
        currentConversationId = conversations[0].id;
    }

    saveConversations();
    renderConversationList();
    renderConversationMessages();
}

function getWelcomeMarkup() {
    const firstName = currentUser?.name
        ? currentUser.name.trim().split(/\s+/)[0]
        : "";

    return `
        <div class="welcome" id="welcome">
            <div class="welcome-mark" aria-hidden="true">
                <svg viewBox="0 0 28 28" fill="none">
                    <path
                        d="M14 3.5 16.6 11l7.9 3-7.9 3L14 24.5 11.4 17l-7.9-3 7.9-3L14 3.5Z"
                        fill="currentColor"
                    />
                </svg>
            </div>

            <h1>
                ${firstName ? `What are we learning today, ${escapeHtml(firstName)}?` : "What are you learning today?"}
            </h1>

            <p>
                Ask a question, explore a difficult idea, or turn your notes into a focused study session.
            </p>

            <div class="suggestions">
                <button
                    class="suggestion"
                    type="button"
                    data-prompt="Explain this concept step by step with a simple real-world example: "
                >
                    <span class="suggestion-icon">✦</span>
                    <div>
                        <strong>Explain a concept</strong>
                        <span>Break down something difficult</span>
                    </div>
                    <span class="suggestion-arrow">↗</span>
                </button>

                <button
                    class="suggestion"
                    type="button"
                    data-prompt="Create a five-question quiz to test my understanding of: "
                >
                    <span class="suggestion-icon">?</span>
                    <div>
                        <strong>Test my knowledge</strong>
                        <span>Build a quick personalized quiz</span>
                    </div>
                    <span class="suggestion-arrow">↗</span>
                </button>

                <button
                    class="suggestion"
                    type="button"
                    data-prompt="Turn these notes into a clear summary with the most important ideas: "
                >
                    <span class="suggestion-icon">≡</span>
                    <div>
                        <strong>Summarize my notes</strong>
                        <span>Find the ideas that matter most</span>
                    </div>
                    <span class="suggestion-arrow">↗</span>
                </button>

                <button
                    class="suggestion"
                    type="button"
                    data-prompt="Create a realistic study plan for this goal and deadline: "
                >
                    <span class="suggestion-icon">◇</span>
                    <div>
                        <strong>Plan a study session</strong>
                        <span>Turn a goal into clear next steps</span>
                    </div>
                    <span class="suggestion-arrow">↗</span>
                </button>
            </div>

            <div class="welcome-footnote">
                <i></i>
                Your conversations are private to your learning space
            </div>
        </div>
    `;
}


function renderConversationMessages() {
    const active = getActiveConversation();

    if (!active || !active.messages.length) {
        chatMessages.innerHTML = getWelcomeMarkup();

        attachPromptButtons();
        return;
    }

    chatMessages.innerHTML = "";

    active.messages.forEach(
        (message) => {
            if (message.role === "user") {
                addUserMessage(message.content);
            }

            if (message.role === "assistant") {
                const aiMessage = createAIMessage();
                renderAIMessage(aiMessage, message.content || "");
                addMessageActions(aiMessage, message.content || "");
            }
        }
    );
}


function persistCurrentMessage(message) {
    const active = ensureActiveConversation();

    if (!active.messages.some((entry) => entry.role === "user" && entry.content === message)) {
        active.messages.push({
            role: "user",
            content: message,
            createdAt: Date.now()
        });

        if (active.title === "New chat" || !active.title) {
            active.title =
                message
                    .trim()
                    .replace(/\s+/g, " ")
                    .slice(0, 32) ||
                "New chat";
        }

        active.updatedAt = Date.now();
        saveConversations();
        renderConversationList();
    }
}


function persistAssistantMessage(content) {
    const active = getActiveConversation();

    if (!active) {
        return;
    }

    if (!active.messages.length || active.messages[active.messages.length - 1].role !== "assistant") {
        active.messages.push({
            role: "assistant",
            content,
            createdAt: Date.now()
        });
    } else {
        active.messages[active.messages.length - 1].content = content;
    }

    active.updatedAt = Date.now();
    saveConversations();
    renderConversationList();
}


function updateComposer() {

    messageInput.style.height =
        "auto";

    messageInput.style.height =
        Math.min(
            messageInput.scrollHeight,
            180
        ) + "px";


    if (isGenerating) {

        sendButton.disabled =
            true;

        return;
    }


    sendButton.disabled =
        !messageInput.value.trim();
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function showStatusToast(message, type = "info") {
    let toast = document.getElementById("EduAI-toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "EduAI-toast";
        toast.className = "status-toast";
        document.body.appendChild(toast);
    }

    toast.className = `status-toast ${type}`;
    toast.textContent = message;
    toast.classList.add("visible");

    clearTimeout(showStatusToast.timeoutId);
    showStatusToast.timeoutId = setTimeout(() => {
        toast.classList.remove("visible");
    }, 2200);
}

function handleStudyToolPrompt(prefix) {
    const text = messageInput.value.trim();
    messageInput.value = text ? `${text}\n\n${prefix}` : prefix;
    updateComposer();
    messageInput.focus();
    scrollToBottom();
}

/* =========================================================
   ENTER / SHIFT + ENTER
========================================================= */

function submitCurrentMessage() {

    if (
        messageInput.value.trim() &&
        !isGenerating
    ) {
        chatForm.requestSubmit();
    }
}


messageInput.addEventListener(
    "keydown",
    function (event) {

        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            submitCurrentMessage();
            return;
        }

        if (event.key === "Escape") {
            messageInput.value = "";
            updateComposer();
            messageInput.blur();
            return;
        }

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();
            submitCurrentMessage();
            return;
        }
    }
);

document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        conversationSearch.focus();
        conversationSearch.select();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        startNewChat();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "/") {
        event.preventDefault();
        messageInput.focus();
        messageInput.select();
    }

    if (event.key === "Escape") {
        if (!authScreen.classList.contains("hidden")) {
            showLanding();
            return;
        }

        if (sidebar.classList.contains("open")) {
            sidebar.classList.remove("open");
            mobileMenuBtn.setAttribute("aria-expanded", "false");
        }
    }
});

/* =========================================================
   SEND MESSAGE
========================================================= */

chatForm.addEventListener(
    "submit",
    async function (event) {

        event.preventDefault();


        if (isGenerating) {
            return;
        }


        const message =
            messageInput.value.trim();


        if (!message) {
            return;
        }


        /*
         * Remember the user's message.
         */
        lastUserMessage =
            message;

        ensureActiveConversation();
        persistCurrentMessage(message);


        /*
         * IMPORTANT:
         *
         * Save the response ID that existed BEFORE
         * this user message.
         *
         * This is useful when regenerating.
         */
        lastUserParentResponseId =
            previousResponseId;


        /*
         * Display user message.
         */
        addUserMessage(message);


        /*
         * Clear input.
         */
        messageInput.value = "";

        messageInput.style.height =
            "auto";


        removeWelcome();


        /*
         * Begin generation.
         */
        setGenerating(true);


        const aiMessage =
            createAIMessage();

        const active =
            getActiveConversation();

        if (active) {
            if (
                !active.messages.length ||
                active.messages[active.messages.length - 1].role !== "assistant"
            ) {
                active.messages.push({
                    role: "assistant",
                    content: "",
                    createdAt: Date.now()
                });
                saveConversations();
                renderConversationList();
            }
        }


        currentController =
            new AbortController();


        try {

            await streamResponse(
                message,
                aiMessage,
                currentController.signal,
                lastUserParentResponseId
            );

        } catch (error) {

            /*
             * Stop is not an error.
             */
            if (
                error.name ===
                "AbortError"
            ) {

                showStoppedMessage(
                    aiMessage
                );

            } else {

                console.error(
                    "EduAI error:",
                    error
                );


                showErrorMessage(
                    aiMessage,
                    error.message
                );
            }

        } finally {

            currentController =
                null;

            setGenerating(false);

            messageInput.focus();
        }
    }
);


/* =========================================================
   STREAM RESPONSE
========================================================= */

async function streamResponse(
    message,
    aiMessage,
    signal,
    parentResponseId
) {

    const response =
        await fetch(
            `${API_URL}/chat`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "Accept":
                        "text/event-stream",

                    ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {})
                },

                body:
                    JSON.stringify({
                        message:
                            message,

                        previousResponseId:
                            parentResponseId
                    }),

                signal:
                    signal
            }
        );


    /*
     * Backend returned an HTTP error.
     */
    if (!response.ok) {

        let errorMessage =
            "Failed to contact EduAI.";


        try {

            const data =
                await response.json();


            errorMessage =
                data.error ||
                errorMessage;

        } catch {
            // Response wasn't JSON.
        }


        throw new Error(
            errorMessage
        );
    }


    /*
     * Browser must support ReadableStream.
     */
    if (!response.body) {

        throw new Error(
            "Streaming is not supported by this browser."
        );
    }


    const reader =
        response.body.getReader();


    const decoder =
        new TextDecoder("utf-8");


    let buffer = "";

    let fullText = "";

    let completed = false;


    /*
     * Read stream.
     */
    while (true) {

        const {
            value,
            done
        } =
            await reader.read();


        if (done) {
            break;
        }


        buffer +=
            decoder.decode(
                value,
                {
                    stream: true
                }
            );


        /*
         * SSE events are separated
         * by two newline characters.
         */
        const events =
            buffer.split("\n\n");


        buffer =
            events.pop() || "";


        for (
            const rawEvent
            of events
        ) {

            const result =
                processSSEEvent(
                    rawEvent
                );


            /*
             * Text arrived.
             */
            if (
                result.type ===
                "text"
            ) {

                fullText +=
                    result.text;


                renderAIMessage(
                    aiMessage,
                    fullText
                );

                persistAssistantMessage(fullText);

                scrollToBottom();
            }


            /*
             * Response ID.
             */
            else if (
                result.type ===
                "response_id"
            ) {

                /*
                 * Only update this when
                 * the response actually exists.
                 */
                if (
                    result.responseId
                ) {

                    previousResponseId =
                        result.responseId;
                }
            }


            /*
             * Generation completed.
             */
            else if (
                result.type ===
                "done"
            ) {

                if (
                    result.responseId
                ) {

                    previousResponseId =
                        result.responseId;
                }


                completed = true;
            }


            /*
             * Backend/OpenAI error.
             */
            else if (
                result.type ===
                "error"
            ) {

                throw new Error(
                    result.error
                );
            }
        }
    }


    /*
     * Process remaining SSE data.
     */
    if (buffer.trim()) {

        const result =
            processSSEEvent(
                buffer
            );


        if (
            result.type ===
            "text"
        ) {

            fullText +=
                result.text;


            renderAIMessage(
                aiMessage,
                fullText
            );

            persistAssistantMessage(fullText);
        }


        if (
            result.type ===
            "response_id"
        ) {

            if (
                result.responseId
            ) {

                previousResponseId =
                    result.responseId;
            }
        }


        if (
            result.type ===
            "done"
        ) {

            if (
                result.responseId
            ) {

                previousResponseId =
                    result.responseId;
            }


            completed = true;
        }


        if (
            result.type ===
            "error"
        ) {

            throw new Error(
                result.error
            );
        }
    }


    /*
     * Add actions only when
     * we actually received text.
     */
    if (
        fullText.trim()
    ) {

        persistAssistantMessage(fullText);
        addMessageActions(
            aiMessage,
            fullText
        );
    }


    /*
     * If the stream ended normally
     * but no completion event arrived,
     * we still keep the generated text.
     */
    if (
        !completed &&
        fullText.trim()
    ) {

        console.warn(
            "EduAI stream ended without a done event."
        );
    }
}


/* =========================================================
   SSE PROCESSOR
========================================================= */

function processSSEEvent(
    rawEvent
) {

    const lines =
        rawEvent.split(/\r?\n/);


    let eventType =
        "message";


    let data = "";


    for (
        const line
        of lines
    ) {

        if (
            line.startsWith("event:")
        ) {

            eventType =
                line
                    .substring(6)
                    .trim();
        }


        if (
            line.startsWith("data:")
        ) {

            data +=
                line
                    .substring(5)
                    .trim();
        }
    }


    if (!data) {

        return {
            type: "empty"
        };
    }


    let parsed;


    try {

        parsed =
            JSON.parse(data);

    } catch {

        return {
            type: "empty"
        };
    }


    if (
        eventType ===
        "response_id"
    ) {

        return {
            type:
                "response_id",

            responseId:
                parsed.responseId
        };
    }


    if (
        eventType ===
        "message"
    ) {

        return {
            type:
                "text",

            text:
                parsed.text || ""
        };
    }


    if (
        eventType ===
        "done"
    ) {

        return {
            type:
                "done",

            responseId:
                parsed.responseId
        };
    }


    if (
        eventType ===
        "error"
    ) {

        return {
            type:
                "error",

            error:
                parsed.error ||
                "EduAI returned an error."
        };
    }


    return {
        type: "empty"
    };
}


/* =========================================================
   USER MESSAGE
========================================================= */

function addUserMessage(
    text
) {

    const message =
        document.createElement(
            "div"
        );


    message.className =
        "message user-message";

    const userInitials = currentUser?.name
        ? currentUser.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase()
        : "YOU";

    message.innerHTML = `
        <div class="avatar user-avatar-message">
            ${escapeHtml(userInitials)}
        </div>

        <div class="message-content">

            <div class="message-body">
                ${escapeHtml(text)}
            </div>

        </div>
    `;


    chatMessages.appendChild(
        message
    );


    scrollToBottom();
}


/* =========================================================
   CREATE AI MESSAGE
========================================================= */

function createAIMessage() {

    const message =
        document.createElement(
            "div"
        );


    message.className =
        "message ai-message";


    message.innerHTML = `
        <div class="avatar ai-avatar">
            <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path
                    d="M14 3.5 16.6 11l7.9 3-7.9 3L14 24.5 11.4 17l-7.9-3 7.9-3L14 3.5Z"
                    fill="currentColor"
                />
            </svg>
        </div>

        <div class="message-content">

            <div class="message-body">

                <div class="typing">

                    <span></span>
                    <span></span>
                    <span></span>

                </div>

            </div>

        </div>
    `;


    chatMessages.appendChild(
        message
    );


    scrollToBottom();


    /*
     * Return both the DOM element
     * and message body.
     */
    return {
        element:
            message,

        body:
            message.querySelector(
                ".message-body"
            )
    };
}


/* =========================================================
   RENDER AI MESSAGE
========================================================= */

function renderAIMessage(
    aiMessage,
    text
) {

    if (
        typeof marked !==
        "undefined"
    ) {

        aiMessage.body.innerHTML =
            marked.parse(text, {
                gfm: true,
                breaks: true
            });

    } else {

        aiMessage.body.textContent =
            text;
    }


    /*
     * Add copy buttons to code blocks.
     */
    addCodeCopyButtons(
        aiMessage.body
    );
}


/* =========================================================
   MESSAGE ACTIONS
========================================================= */

async function copyTextToClipboard(
    text
) {

    if (
        navigator.clipboard &&
        window.isSecureContext
    ) {
        await navigator.clipboard.writeText(text);
        return;
    }


    const temp =
        document.createElement(
            "textarea"
        );

    temp.value = text;
    temp.setAttribute(
        "readonly",
        ""
    );
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();

    try {
        document.execCommand("copy");
    } finally {
        document.body.removeChild(temp);
    }
}


function addMessageActions(
    aiMessage,
    text
) {

    const content =
        aiMessage.element.querySelector(
            ".message-content"
        );


    /*
     * Prevent duplicate action bars.
     */
    const existing =
        content.querySelector(
            ".message-actions"
        );


    if (existing) {
        existing.remove();
    }


    const actions =
        document.createElement(
            "div"
        );


    actions.className =
        "message-actions";


    actions.innerHTML = `
        <button
            type="button"
            class="message-action copy-btn"
        >
            Copy
        </button>

        <button
            type="button"
            class="message-action regenerate-btn"
        >
            Regenerate
        </button>
    `;


    content.appendChild(
        actions
    );


    /*
     * COPY
     */
    const copyButton =
        actions.querySelector(
            ".copy-btn"
        );


    copyButton.addEventListener(
        "click",
        async function () {

            try {

                await copyTextToClipboard(text);

                copyButton.textContent =
                    "Copied!";


                setTimeout(
                    function () {

                        copyButton.textContent =
                            "Copy";

                    },
                    1500
                );

            } catch {

                copyButton.textContent =
                    "Copy failed";


                setTimeout(
                    function () {

                        copyButton.textContent =
                            "Copy";

                    },
                    1500
                );
            }
        }
    );


    /*
     * REGENERATE
     */
    const regenerateButton =
        actions.querySelector(
            ".regenerate-btn"
        );


    regenerateButton.addEventListener(
        "click",
        regenerateLastMessage
    );
}


/* =========================================================
   CODE BLOCK COPY BUTTONS
========================================================= */

function addCodeCopyButtons(
    container
) {

    const codeBlocks =
        container.querySelectorAll(
            "pre"
        );


    codeBlocks.forEach(
        function (pre) {

            /*
             * Don't add twice.
             */
            if (
                pre.dataset.copyReady ===
                "true"
            ) {
                return;
            }


            pre.dataset.copyReady =
                "true";


            const code =
                pre.querySelector(
                    "code"
                );


            if (!code) {
                return;
            }


            const button =
                document.createElement(
                    "button"
                );


            button.type =
                "button";


            button.className =
                "code-copy-button";


            button.textContent =
                "Copy";


            pre.style.position =
                "relative";


            pre.appendChild(
                button
            );


            button.addEventListener(
                "click",
                async function () {

                    try {

                        await copyTextToClipboard(
                            code.textContent || ""
                        );

                        button.textContent =
                            "Copied!";


                        setTimeout(
                            function () {

                                button.textContent =
                                    "Copy";

                            },
                            1500
                        );

                    } catch {

                        button.textContent =
                            "Failed";
                    }
                }
            );
        }
    );
}


/* =========================================================
   REGENERATE
========================================================= */

async function regenerateLastMessage() {

    if (
        isGenerating ||
        !lastUserMessage
    ) {
        return;
    }


    /*
     * Remove the previous AI response.
     */
    const aiMessages =
        chatMessages.querySelectorAll(
            ".ai-message"
        );


    const lastAI =
        aiMessages[
            aiMessages.length - 1
        ];


    if (lastAI) {
        lastAI.remove();
    }


    /*
     * IMPORTANT:
     *
     * Regenerate from the response that
     * existed BEFORE the user's question.
     *
     * This prevents the old AI answer from
     * becoming the context for the new answer.
     */
    const parentResponseId =
        lastUserParentResponseId;


    setGenerating(true);


    const aiMessage =
        createAIMessage();


    currentController =
        new AbortController();


    try {

        await streamResponse(
            lastUserMessage,
            aiMessage,
            currentController.signal,
            parentResponseId
        );

    } catch (error) {

        if (
            error.name ===
            "AbortError"
        ) {

            showStoppedMessage(
                aiMessage
            );

        } else {

            console.error(
                "Regeneration error:",
                error
            );


            showErrorMessage(
                aiMessage,
                error.message
            );
        }

    } finally {

        currentController =
            null;

        setGenerating(false);

        messageInput.focus();
    }
}


/* =========================================================
   STOP GENERATION
========================================================= */

stopButton.addEventListener(
    "click",
    function () {

        if (
            currentController
        ) {

            currentController.abort();

            currentController =
                null;
        }
    }
);


/* =========================================================
   GENERATING STATE
========================================================= */

function setGenerating(
    value
) {

    isGenerating =
        value;


    messageInput.disabled =
        value;


    stopButton.hidden =
        !value;


    if (value) {

        sendButton.disabled =
            true;

    } else {

        sendButton.disabled =
            !messageInput.value.trim();
    }
}


/* =========================================================
   STOPPED MESSAGE
========================================================= */

function showStoppedMessage(
    aiMessage
) {

    if (
        !aiMessage.body.textContent.trim()
    ) {

        aiMessage.body.innerHTML =
            `
            <em>
                Generation stopped.
            </em>
            `;
    }
}


/* =========================================================
   ERROR MESSAGE
========================================================= */

function showErrorMessage(
    aiMessage,
    error
) {

    aiMessage.body.innerHTML = `
        <div class="error-message">

            <strong>
                Something went wrong.
            </strong>

            <p>
                ${escapeHtml(
                    error ||
                    "Unknown error."
                )}
            </p>

        </div>
    `;
}


/* =========================================================
   NEW CHAT
========================================================= */

newChatBtn.addEventListener(
    "click",
    startNewChat
);


clearChatBtn.addEventListener(
    "click",
    startNewChat
);


function exportCurrentConversation() {
    const active = getActiveConversation();

    if (!active) {
        return;
    }

    const payload = {
        exportedAt: new Date().toISOString(),
        conversation: active
    };

    const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        {
            type: "application/json"
        }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle =
        (active.title || "EduAI-chat")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-") ||
        "EduAI-chat";

    link.href = url;
    link.download = `${safeTitle}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}


function importConversationFile(file) {
    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = function (event) {
        try {
            const parsed = JSON.parse(
                event.target.result
            );

            const imported =
                parsed.conversation || parsed;

            if (!imported || !Array.isArray(imported.messages)) {
                throw new Error(
                    "Invalid conversation file."
                );
            }

            const normalized = {
                id:
                    imported.id ||
                    crypto.randomUUID(),
                title:
                    imported.title || "Restored chat",
                createdAt:
                    imported.createdAt || Date.now(),
                updatedAt:
                    imported.updatedAt || Date.now(),
                messages:
                    imported.messages || []
            };

            conversations = [normalized, ...conversations.filter((item) => item.id !== normalized.id)];
            currentConversationId = normalized.id;
            saveConversations();
            renderConversationList();
            renderConversationMessages();
            showStatusToast("Conversation imported successfully.", "success");
        } catch (error) {
            console.error(
                "Restore failed:",
                error
            );
            showStatusToast("That file is not a valid EduAI conversation.", "error");
        }
    };

    reader.readAsText(file);
}


function toggleSidebar() {
    if (window.innerWidth <= 820) {
        sidebar.classList.toggle("open");
        mobileMenuBtn.setAttribute(
            "aria-expanded",
            String(sidebar.classList.contains("open"))
        );
        return;
    }

    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle(
        "sidebar-collapsed",
        sidebarCollapsed
    );
}


function startNewChat() {

    if (isGenerating) {
        return;
    }


    previousResponseId =
        null;


    lastUserMessage =
        "";


    lastUserParentResponseId =
        null;

    currentConversationId = null;

    const newConversation =
        createConversation("New chat");

    chatMessages.innerHTML = getWelcomeMarkup();


    attachPromptButtons();


    messageInput.value =
        "";


    messageInput.style.height =
        "auto";


    updateComposer();

    renderConversationList();

    messageInput.focus();
}


/* =========================================================
   PROMPT BUTTONS
========================================================= */

function attachPromptButtons() {

    document
        .querySelectorAll(
            "[data-prompt]"
        )
        .forEach(
            function (button) {
                if (button.dataset.promptBound === "true") {
                    return;
                }

                button.dataset.promptBound = "true";

                button.addEventListener(
                    "click",
                    function () {
                        handleStudyToolPrompt(button.dataset.prompt);
                    }
                );
            }
        );
}


attachPromptButtons();

uploadNotesBtn.addEventListener("click", () => notesUploadInput.click());

notesUploadInput.addEventListener("change", function (event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const info = `${file.name} • ${(file.size / 1024).toFixed(1)} KB`;
    uploadedNotesMeta.textContent = info;

    if (file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".md")) {
        const reader = new FileReader();
        reader.onload = function (loadEvent) {
            const content = String(loadEvent.target?.result || "");
            messageInput.value = `Use these notes as context for my question:\n\n${content.slice(0, 4000)}`;
            updateComposer();
            messageInput.focus();
            showStatusToast("Notes loaded into the prompt.", "success");
        };
        reader.readAsText(file);
    } else {
        messageInput.value = `I uploaded ${file.name}. Please help me study this material and summarize the key ideas.`;
        updateComposer();
        messageInput.focus();
        showStatusToast("File attached. You can ask about it now.", "success");
    }

    notesUploadInput.value = "";
});


/* =========================================================
   MOBILE MENU
========================================================= */

mobileMenuBtn.addEventListener(
    "click",
    function () {
        sidebar.classList.add("open");
        mobileMenuBtn.setAttribute("aria-expanded", "true");
    }
);

sidebarToggleBtn.addEventListener(
    "click",
    function () {
        toggleSidebar();
    }
);

if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", function () {
        sidebar.classList.remove("open");
        mobileMenuBtn.setAttribute("aria-expanded", "false");
    });
}

exportChatBtn.addEventListener(
    "click",
    exportCurrentConversation
);

restoreChatBtn.addEventListener(
    "click",
    function () {
        restoreChatInput.click();
    }
);

restoreChatInput.addEventListener(
    "change",
    function (event) {
        const file = event.target.files?.[0];
        importConversationFile(file);
        restoreChatInput.value = "";
    }
);

logoutBtn.addEventListener("click", () => {
    clearAuthSession();
    authForm.reset();
    showLanding();
    showStatusToast("Logged out.", "success");
});

authTabs.forEach((tab) => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
});

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
        setAuthMode(button.dataset.authMode);
        showAuthScreen(true);
        authEmail.focus();
    });
});

closeAuthBtn.addEventListener("click", showLanding);
if (authBackdrop) {
    authBackdrop.addEventListener("click", showLanding);
}
authSwitchBtn.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
passwordToggle.addEventListener("click", () => {
    const isHidden = authPassword.type === "password";
    authPassword.type = isHidden ? "text" : "password";
    passwordToggle.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    passwordToggle.classList.toggle("password-visible", isHidden);
});
composerAttach.addEventListener("click", () => notesUploadInput.click());

authForm.addEventListener("submit", submitAuthForm);

/* =========================================================
   REMOVE WELCOME
========================================================= */

function removeWelcome() {

    const welcome =
        document.getElementById(
            "welcome"
        );


    if (welcome) {
        welcome.remove();
    }
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(
    text
) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        text;


    return div.innerHTML;
}


/* =========================================================
   SCROLL
========================================================= */

function scrollToBottom() {

    requestAnimationFrame(
        function () {

            chatMessages.scrollTop =
                chatMessages.scrollHeight;
        }
    );
}


/* =========================================================
   INITIAL STATE
========================================================= */

stopButton.hidden =
    true;

setAuthMode("login");
updateUserBadge();
applyTheme(
    localStorage.getItem(THEME_KEY) || "dark"
);

if (!conversations.length) {
    createConversation("New chat");
} else {
    currentConversationId = conversations[0].id;
}

renderConversationList();
renderConversationMessages();
updateComposer();

if (authToken) {
    showApp();
    loadCurrentUser();
} else {
    showLanding();
    messageInput.blur();
}
