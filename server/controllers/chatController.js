const { getStore } = require("../store");
const { getProvider, recordAIFailure, recordAISuccess, isAbortError } = require("../services/ai");
const { sanitizeSettings, buildSystemPrompt, buildHistory, titleFromMessage } = require("../services/tutor");

const MAX_MESSAGE_LENGTH = 20000;
const HEARTBEAT_MS = 15000;

/* One generation per conversation at a time prevents duplicate or interleaved replies. */
const activeGenerations = new Set();

function sendSSE(res, event, data) {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/*
 * POST /api/chat
 * body: { conversationId, message?, regenerate?, settings? }
 *
 * Streams Server-Sent Events: start, delta, done, error.
 * Context is rebuilt from the stored conversation, so it is correct after reloads,
 * conversation switches, and regeneration.
 */
async function sendMessage(req, res, next) {
    const { conversationId, regenerate = false } = req.body || {};
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const userId = req.user.id;
    const store = getStore();

    if (typeof conversationId !== "string" || !conversationId) {
        return res.status(400).json({ success: false, error: "conversationId is required." });
    }
    if (!regenerate && !message) {
        return res.status(400).json({ success: false, error: "Please type a message first." });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ success: false, error: `Messages are limited to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters. Upload long notes as study material instead.` });
    }

    const provider = getProvider();
    if (!provider.configured) {
        return res.status(503).json({ success: false, code: "ai_not_configured", error: "The AI service is not configured on the server. Set OPENAI_API_KEY (or OPENAI_BASE_URL for a local model) in server/.env." });
    }

    const lockKey = `${userId}:${conversationId}`;
    if (activeGenerations.has(lockKey)) {
        return res.status(409).json({ success: false, code: "busy", error: "EduAI is still answering in this conversation. Stop it or wait for it to finish." });
    }
    activeGenerations.add(lockKey);

    const controller = new AbortController();
    let heartbeat = null;
    let fullText = "";
    let saved = false;

    res.on("close", () => {
        if (!res.writableFinished) controller.abort();
    });

    async function saveAssistant(meta) {
        if (saved || !fullText.trim()) return null;
        saved = true;
        return store.addMessage(conversationId, { role: "assistant", content: fullText, meta });
    }

    try {
        let conversation = await store.getConversation(userId, conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        let settings = sanitizeSettings(conversation.settings);
        if (req.body.settings) {
            settings = sanitizeSettings({ ...settings, ...req.body.settings });
            await store.updateConversation(userId, conversationId, { settings });
        }

        let userMessage = null;
        let title = conversation.title;

        if (regenerate) {
            const last = conversation.messages[conversation.messages.length - 1];
            if (last?.role === "assistant") {
                await store.deleteMessage(conversationId, last.id);
                conversation.messages.pop();
            }
            if (conversation.messages[conversation.messages.length - 1]?.role !== "user") {
                return res.status(400).json({ success: false, error: "There is no question to answer again." });
            }
        } else {
            userMessage = await store.addMessage(conversationId, { role: "user", content: message });
            conversation.messages.push(userMessage);

            if (conversation.messages.filter((item) => item.role === "user").length === 1 && /^(new (chat|conversation))?$/i.test(conversation.title || "")) {
                title = titleFromMessage(message);
                await store.updateConversation(userId, conversationId, { title });
            }
        }

        const materials = settings.materialIds?.length ? await store.getMaterials(userId, settings.materialIds) : [];
        const promptMessages = [
            { role: "system", content: buildSystemPrompt(settings, materials) },
            ...buildHistory(conversation.messages),
        ];

        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();

        sendSSE(res, "start", {
            userMessage,
            title,
            settings,
            materials: materials.map(({ id, name, truncated }) => ({ id, name, truncated })),
        });

        heartbeat = setInterval(() => {
            if (!res.writableEnded) res.write(": keep-alive\n\n");
        }, HEARTBEAT_MS);

        for await (const text of provider.streamChat({ messages: promptMessages, signal: controller.signal })) {
            fullText += text;
            sendSSE(res, "delta", { text });
        }

        recordAISuccess();

        if (!fullText.trim()) {
            sendSSE(res, "error", { code: "ai_empty", error: "The AI returned an empty answer. Please try again." });
        } else {
            const assistantMessage = await saveAssistant({});
            sendSSE(res, "done", { message: assistantMessage });
        }
        res.end();
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            // Student pressed Stop or closed the tab: keep what was already written.
            await saveAssistant({ stopped: true }).catch((saveError) => console.error("Failed to save partial answer:", saveError.message));
            if (!res.writableEnded) res.end();
            return;
        }

        const aiError = error.name === "AIError" ? error : null;
        if (aiError) {
            recordAIFailure(aiError);
            console.error(`AI request failed [${aiError.code}]:`, aiError.cause?.message || aiError.message);
            await saveAssistant({ incomplete: true }).catch(() => {});
        }

        if (!res.headersSent) {
            if (aiError) {
                return res.status(aiError.status).json({ success: false, code: aiError.code, error: aiError.message });
            }
            return next(error);
        }

        if (!aiError) console.error("Chat stream failed:", error);
        sendSSE(res, "error", {
            code: aiError?.code || "server_error",
            error: aiError?.message || "Something went wrong while generating the answer. Please try again.",
            partialSaved: saved,
        });
        res.end();
    } finally {
        clearInterval(heartbeat);
        activeGenerations.delete(lockKey);
    }
}

module.exports = {
    sendMessage,
};
