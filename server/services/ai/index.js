const { createOpenAICompatibleProvider } = require("./openaiCompatibleProvider");
const { AIError, isAbortError, normalizeAIError } = require("./errors");

/*
 * Single entry point for AI access. To add a different provider, implement the same
 * shape ({ name, model, configured, streamChat, complete, checkConnection }) and
 * select it here with AI_PROVIDER.
 */
const providerFactories = {
    openai: () =>
        createOpenAICompatibleProvider({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL,
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 120000,
        }),
};

let provider = null;
let lastStatus = null;
let lastStatusAt = 0;
const STATUS_TTL_MS = 60 * 1000;

function getProvider() {
    if (!provider) {
        const name = (process.env.AI_PROVIDER || "openai").toLowerCase();
        const factory = providerFactories[name];
        if (!factory) {
            throw new Error(`Unknown AI_PROVIDER "${name}". Supported: ${Object.keys(providerFactories).join(", ")}.`);
        }
        provider = factory();
    }
    return provider;
}

function resetProvider() {
    provider = null;
    lastStatus = null;
    lastStatusAt = 0;
}

/* Cached live check so the UI can warn students before they type a long question. */
async function getAIStatus({ force = false } = {}) {
    const current = getProvider();
    const base = { provider: current.name, model: current.model, configured: current.configured };

    if (!current.configured) {
        return { ...base, ok: false, code: "ai_not_configured", message: "The AI service is not configured on the server." };
    }

    if (!force && lastStatus && Date.now() - lastStatusAt < STATUS_TTL_MS) {
        return { ...base, ...lastStatus };
    }

    lastStatus = await current.checkConnection();
    lastStatusAt = Date.now();
    return { ...base, ...lastStatus };
}

function recordAIFailure(error) {
    if (error instanceof AIError && !error.retryable) {
        lastStatus = { ok: false, code: error.code, message: error.message };
        lastStatusAt = Date.now();
    }
}

function recordAISuccess() {
    lastStatus = { ok: true };
    lastStatusAt = Date.now();
}

module.exports = {
    getProvider,
    resetProvider,
    getAIStatus,
    recordAIFailure,
    recordAISuccess,
    AIError,
    isAbortError,
    normalizeAIError,
};
