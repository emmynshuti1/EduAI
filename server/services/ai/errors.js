/*
 * Normalizes provider failures into a small set of codes the client can act on.
 * Messages are written for students; the server log keeps the technical detail.
 */

class AIError extends Error {
    constructor(code, message, { status = 503, retryable = false, cause } = {}) {
        super(message);
        this.name = "AIError";
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        if (cause) this.cause = cause;
    }
}

function isAbortError(error) {
    return (
        error?.name === "AbortError" ||
        error?.name === "APIUserAbortError" ||
        error?.constructor?.name === "APIUserAbortError"
    );
}

function normalizeAIError(error) {
    if (error instanceof AIError) return error;

    const status = error?.status;
    const code = error?.code || error?.error?.code || "";
    const type = error?.type || error?.error?.type || "";
    const name = error?.constructor?.name || error?.name || "";

    if (name === "APIConnectionTimeoutError" || /timed? ?out/i.test(error?.message || "")) {
        return new AIError("ai_timeout", "The AI service took too long to respond. Please try again.", { status: 504, retryable: true, cause: error });
    }

    if (name === "APIConnectionError" || error?.cause?.code === "ECONNREFUSED" || error?.code === "ECONNREFUSED") {
        return new AIError("ai_unreachable", "EduAI could not reach the AI service. Check the server's network connection or AI provider settings.", { status: 503, retryable: true, cause: error });
    }

    if (status === 401 || code === "invalid_api_key") {
        return new AIError("ai_auth", "The AI provider rejected EduAI's API key. The server administrator needs to update OPENAI_API_KEY.", { status: 503, cause: error });
    }

    if (status === 403) {
        return new AIError("ai_forbidden", "The AI provider refused access for this account or model. Check the API key's permissions.", { status: 503, cause: error });
    }

    if (status === 429 && (code === "insufficient_quota" || type === "insufficient_quota")) {
        return new AIError("ai_quota", "The AI account has run out of credits or reached its spending limit. Add credits or raise the limit, then try again.", { status: 503, cause: error });
    }

    if (status === 429) {
        return new AIError("ai_rate_limited", "The AI service is receiving too many requests right now. Wait a moment and try again.", { status: 429, retryable: true, cause: error });
    }

    if (status === 404 || code === "model_not_found") {
        return new AIError("ai_model", "The configured AI model is not available. Check the AI model setting on the server.", { status: 503, cause: error });
    }

    if (status === 400 && (code === "context_length_exceeded" || /context length|maximum context/i.test(error?.message || ""))) {
        return new AIError("ai_context", "This conversation is too long for the AI model. Start a new conversation or remove attached material.", { status: 400, cause: error });
    }

    if (status >= 500) {
        return new AIError("ai_provider_error", "The AI service had a temporary problem. Please try again.", { status: 502, retryable: true, cause: error });
    }

    return new AIError("ai_error", "The AI service could not complete this request.", { status: 502, cause: error });
}

module.exports = {
    AIError,
    isAbortError,
    normalizeAIError,
};
