const OpenAI = require("openai");
const { AIError, isAbortError, normalizeAIError } = require("./errors");

/*
 * Works with OpenAI and any server exposing the OpenAI Chat Completions API
 * (Ollama, LM Studio, vLLM, ...). Set OPENAI_BASE_URL to point at a local backend.
 */
function createOpenAICompatibleProvider({ apiKey, baseURL, model, timeoutMs = 120000 }) {
    const isLocal = Boolean(baseURL) && !/api\.openai\.com/.test(baseURL);
    const configured = Boolean(model) && (isLocal || (apiKey && !/your_openai_api_key/i.test(apiKey)));

    const client = configured
        ? new OpenAI({
            apiKey: apiKey || "not-needed-for-local-backends",
            baseURL: baseURL || undefined,
            timeout: timeoutMs,
            maxRetries: 1,
        })
        : null;

    function requireClient() {
        if (!client) {
            throw new AIError(
                "ai_not_configured",
                "The AI service is not configured. The server administrator needs to set OPENAI_API_KEY (or OPENAI_BASE_URL for a local model).",
                { status: 503 }
            );
        }
        return client;
    }

    async function* streamChat({ messages, signal, temperature = 0.4, maxTokens = 2000 }) {
        const api = requireClient();
        let stream;

        try {
            stream = await api.chat.completions.create(
                { model, messages, temperature, max_tokens: maxTokens, stream: true },
                { signal }
            );

            for await (const chunk of stream) {
                const text = chunk?.choices?.[0]?.delta?.content;
                if (text) yield text;
            }

            // The SDK ends the iteration quietly when aborted; surface it so callers can tell.
            if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        } catch (error) {
            if (isAbortError(error) || signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
            throw normalizeAIError(error);
        }
    }

    async function complete({ messages, signal, temperature = 0.3, maxTokens = 2500, json = false }) {
        const api = requireClient();
        const request = { model, messages, temperature, max_tokens: maxTokens };
        if (json) request.response_format = { type: "json_object" };

        try {
            const response = await api.chat.completions.create(request, { signal });
            return response?.choices?.[0]?.message?.content || "";
        } catch (error) {
            if (isAbortError(error) || signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
            throw normalizeAIError(error);
        }
    }

    async function checkConnection() {
        const api = requireClient();
        try {
            await api.chat.completions.create({
                model,
                messages: [{ role: "user", content: "Reply with OK." }],
                max_tokens: 3,
            });
            return { ok: true };
        } catch (error) {
            const normalized = normalizeAIError(error);
            return { ok: false, code: normalized.code, message: normalized.message };
        }
    }

    return {
        name: isLocal ? "openai-compatible" : "openai",
        model,
        configured,
        streamChat,
        complete,
        checkConnection,
    };
}

module.exports = { createOpenAICompatibleProvider };
