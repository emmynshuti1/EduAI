/* =========================================================
   API CLIENT
   All server communication goes through here so auth, errors and
   streaming are handled the same way everywhere.
========================================================= */

const API_URL =
    window.location.protocol.startsWith("http")
        ? `${window.location.origin}/api`
        : "http://localhost:5000/api";

const TOKEN_KEY = "EduAI-auth-token";

export const safeStorage = {
    get(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    },
};

let authToken = safeStorage.get(TOKEN_KEY) || "";
let onUnauthorized = () => {};

export class ApiError extends Error {
    constructor(message, { status = 0, code = "" } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

export function setToken(token) {
    authToken = token || "";
    if (authToken) safeStorage.set(TOKEN_KEY, authToken);
    else safeStorage.remove(TOKEN_KEY);
}

export function hasToken() {
    return Boolean(authToken);
}

export function setUnauthorizedHandler(handler) {
    onUnauthorized = handler;
}

function networkError(error) {
    if (error?.name === "AbortError") return error;
    return new ApiError("Can't reach the EduAI server. Check your connection, or make sure the server is running (cd server && npm start).", { code: "network" });
}

async function readError(response) {
    let data = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    const message =
        data?.error ||
        data?.errors?.[0]?.msg ||
        (response.status === 429 ? "Too many requests. Please wait a moment." : `Request failed (${response.status}).`);
    return new ApiError(message, { status: response.status, code: data?.code || "" });
}

export async function request(path, { method = "GET", body, signal, form } = {}) {
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            method,
            headers,
            body: form || (body !== undefined ? JSON.stringify(body) : undefined),
            signal,
        });
    } catch (error) {
        throw networkError(error);
    }

    if (!response.ok) {
        const error = await readError(response);
        if (response.status === 401 && authToken && !path.startsWith("/auth/login")) onUnauthorized(error);
        throw error;
    }

    return response.status === 204 ? null : response.json();
}

/*
 * POST /api/chat and dispatch Server-Sent Events to handlers.
 * Resolves with the `done` payload; rejects with ApiError or AbortError.
 */
export async function streamChat(body, { signal, onStart, onDelta } = {}) {
    let response;
    try {
        response = await fetch(`${API_URL}/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify(body),
            signal,
        });
    } catch (error) {
        throw networkError(error);
    }

    if (!response.ok) {
        const error = await readError(response);
        if (response.status === 401) onUnauthorized(error);
        throw error;
    }
    if (!response.body) throw new ApiError("This browser does not support streaming responses.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let result = null;

    const handle = (raw) => {
        let event = "message";
        const dataLines = [];
        for (const line of raw.split(/\r?\n/)) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (!dataLines.length) return;

        let data;
        try { data = JSON.parse(dataLines.join("\n")); } catch { return; }

        if (event === "start") onStart?.(data);
        else if (event === "delta") onDelta?.(data.text || "");
        else if (event === "done") result = data;
        else if (event === "error") throw new ApiError(data.error || "EduAI could not finish this answer.", { code: data.code });
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || "";
            events.forEach(handle);
        }
        if (buffer.trim()) handle(buffer);
    } catch (error) {
        if (error instanceof ApiError || error?.name === "AbortError") throw error;
        throw new ApiError("The connection was interrupted before the answer finished.", { code: "network" });
    }

    if (!result) throw new ApiError("The answer was interrupted before it finished. You can regenerate it.", { code: "incomplete" });
    return result;
}

export const api = {
    get: (path, options) => request(path, { ...options, method: "GET" }),
    post: (path, body, options) => request(path, { ...options, method: "POST", body }),
    patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
    delete: (path, options) => request(path, { ...options, method: "DELETE" }),
    upload: (path, file, options) => {
        const form = new FormData();
        form.append("file", file);
        return request(path, { ...options, method: "POST", form });
    },
};
