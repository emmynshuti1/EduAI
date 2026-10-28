/*
 * End-to-end API tests against a mock OpenAI-compatible provider.
 * Uses file storage by default; set TEST_DATABASE_URL to run the same suite on PostgreSQL.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startMockProvider } = require("./helpers/mockProvider");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eduai-test-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-checks-1234";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "";
process.env.POSTGRES_URL = "";
process.env.EDUAI_DATA_FILE = path.join(tempDir, "data.json");
process.env.OPENAI_MODEL = "test-model";
process.env.OPENAI_API_KEY = "";
process.env.AI_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AUTH_RATE_LIMIT = "1000";

let mock;
let server;
let baseUrl;
let store;

async function api(method, url, { token, body, headers = {} } = {}) {
    const isForm = body instanceof FormData;
    const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
            ...headers,
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
}

/* Reads an SSE response into a list of { event, data } items. */
async function readSSE(response, { onEvent } = {}) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
            const event = part.match(/^event: (.*)$/m)?.[1];
            const data = part.match(/^data: (.*)$/m)?.[1];
            if (!event) continue;
            const item = { event, data: JSON.parse(data) };
            events.push(item);
            if (onEvent && onEvent(item) === false) {
                await reader.cancel();
                return events;
            }
        }
    }
    return events;
}

function chat(token, body, signal) {
    return fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
    });
}

async function register(name) {
    const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const { status, data } = await api("POST", "/api/auth/register", { body: { name, email, password: "correct horse" } });
    assert.equal(status, 201, JSON.stringify(data));
    return { token: data.token, user: data.user, email };
}

async function newConversation(token, settings) {
    const { status, data } = await api("POST", "/api/conversations", { token, body: { settings } });
    assert.equal(status, 201);
    return data.conversation;
}

async function waitFor(check, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const result = await check();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for condition");
}

before(async () => {
    mock = await startMockProvider();
    process.env.OPENAI_BASE_URL = mock.url;

    const { createApp } = require("../app");
    store = require("../store").getStore();
    await store.init();

    await new Promise((resolve) => {
        server = createApp().listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server?.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await mock.close();
    await store.close?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test("auth: register, login, profile, and validation", async () => {
    const { token, email } = await register("Ada");

    const me = await api("GET", "/api/auth/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, "Ada");
    assert.equal(me.data.user.passwordHash, undefined);

    const login = await api("POST", "/api/auth/login", { body: { email: email.toUpperCase(), password: "correct horse" } });
    assert.equal(login.status, 200);

    const wrong = await api("POST", "/api/auth/login", { body: { email, password: "nope-nope" } });
    assert.equal(wrong.status, 401);

    const duplicate = await api("POST", "/api/auth/register", { body: { name: "Ada", email, password: "correct horse" } });
    assert.equal(duplicate.status, 409);

    const weak = await api("POST", "/api/auth/register", { body: { name: "Bob", email: "bob@example.com", password: "123" } });
    assert.equal(weak.status, 400);
    assert.match(weak.data.error, /at least 8/);

    const bad = await api("GET", "/api/auth/me", { token: "not-a-token" });
    assert.equal(bad.status, 401);
});

test("security: AI and data endpoints require authentication; headers are set", async () => {
    for (const [method, url] of [["POST", "/api/chat"], ["GET", "/api/conversations"], ["GET", "/api/notes"], ["GET", "/api/materials"], ["POST", "/api/quizzes"], ["GET", "/api/status"]]) {
        const { status } = await api(method, url, { body: method === "POST" ? {} : undefined });
        assert.equal(status, 401, `${method} ${url} should require auth`);
    }

    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");

    for (const file of ["marked.js", "purify.js", "highlight.js"]) {
        const vendor = await fetch(`${baseUrl}/vendor/${file}`);
        assert.equal(vendor.status, 200, file);
    }
});

test("chat: streams, persists both messages, sets a title, and uses tutor settings", async () => {
    const { token } = await register("Grace");
    const conversation = await newConversation(token, { level: "university", mode: "guided", subject: "Physics" });

    mock.handler = () => ({ stream: ["Newton's ", "second ", "law..."] });
    const response = await chat(token, { conversationId: conversation.id, message: "What is F = ma?" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);

    const events = await readSSE(response);
    assert.deepEqual(events.map((event) => event.event), ["start", "delta", "delta", "delta", "done"]);
    assert.equal(events[0].data.title, "What is F = ma?");
    assert.equal(events.at(-1).data.message.content, "Newton's second law...");

    const system = mock.requests.at(-1).messages[0];
    assert.equal(system.role, "system");
    assert.match(system.content, /university student/);
    assert.match(system.content, /Socratic/);
    assert.match(system.content, /Physics/);
    assert.match(system.content, /Never invent citations/);

    const saved = await api("GET", `/api/conversations/${conversation.id}`, { token });
    assert.deepEqual(saved.data.conversation.messages.map((message) => [message.role, message.content]), [
        ["user", "What is F = ma?"],
        ["assistant", "Newton's second law..."],
    ]);
    assert.equal(saved.data.conversation.title, "What is F = ma?");
});

test("chat: follow-up questions include the conversation history, and conversations are isolated", async () => {
    const { token } = await register("Alan");
    const first = await newConversation(token);
    const second = await newConversation(token);

    mock.handler = () => ({ stream: ["Photosynthesis turns light into sugar."] });
    await readSSE(await chat(token, { conversationId: first.id, message: "Explain photosynthesis" }));

    mock.handler = () => ({ stream: ["Recursion is a function calling itself."] });
    await readSSE(await chat(token, { conversationId: second.id, message: "Explain recursion" }));

    mock.handler = () => ({ stream: ["Chlorophyll absorbs light."] });
    await readSSE(await chat(token, { conversationId: first.id, message: "Which pigment is involved?" }));

    const history = mock.requests.at(-1).messages.slice(1);
    assert.deepEqual(history.map((message) => message.content), [
        "Explain photosynthesis",
        "Photosynthesis turns light into sugar.",
        "Which pigment is involved?",
    ]);

    const other = await register("Mallory");
    const peek = await api("GET", `/api/conversations/${first.id}`, { token: other.token });
    assert.equal(peek.status, 404);
    const hijack = await chat(other.token, { conversationId: first.id, message: "hi" });
    assert.equal(hijack.status, 404);
    const list = await api("GET", "/api/conversations", { token: other.token });
    assert.equal(list.data.conversations.length, 0);
});

test("chat: stopping keeps the partial answer, and regenerate replaces the last answer", async () => {
    const { token } = await register("Katherine");
    const conversation = await newConversation(token);

    mock.handler = () => ({ stream: Array.from({ length: 40 }, (_, index) => `w${index} `), delayMs: 40 });
    const controller = new AbortController();
    let deltas = 0;
    const response = await chat(token, { conversationId: conversation.id, message: "Write a long essay" }, controller.signal);

    await readSSE(response, {
        onEvent: (event) => {
            if (event.event === "delta" && ++deltas === 3) {
                controller.abort();
                return false;
            }
            return true;
        },
    }).catch((error) => assert.equal(error.name, "AbortError"));

    const stopped = await waitFor(async () => {
        const { data } = await api("GET", `/api/conversations/${conversation.id}`, { token });
        const last = data.conversation.messages.at(-1);
        return last?.role === "assistant" ? last : null;
    });
    assert.equal(stopped.meta.stopped, true);
    assert.ok(stopped.content.startsWith("w0 w1 w2"));
    assert.ok(!stopped.content.includes("w39"), "generation should have been cancelled upstream");
    await waitFor(() => mock.lastStreamClosedEarly === true);

    mock.handler = () => ({ stream: ["A better essay."] });
    const regenerated = await readSSE(await chat(token, { conversationId: conversation.id, regenerate: true }));
    assert.equal(regenerated.at(-1).event, "done");
    assert.equal(regenerated[0].data.userMessage, null);

    const { data } = await api("GET", `/api/conversations/${conversation.id}`, { token });
    assert.deepEqual(data.conversation.messages.map((message) => message.content), ["Write a long essay", "A better essay."]);
    const lastPrompt = mock.requests.at(-1).messages;
    assert.equal(lastPrompt.at(-1).content, "Write a long essay");
});

test("chat: concurrent generation in one conversation is rejected", async () => {
    const { token } = await register("Barbara");
    const conversation = await newConversation(token);

    mock.handler = () => ({ stream: ["slow ", "answer"], delayMs: 300 });
    const first = chat(token, { conversationId: conversation.id, message: "First" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await chat(token, { conversationId: conversation.id, message: "Second" });
    assert.equal(second.status, 409);
    await readSSE(await first);
});

test("chat: provider failures are reported with clear, specific codes", async () => {
    const { token } = await register("Edsger");
    const cases = [
        [{ status: 401, error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }, "ai_auth", /API key/],
        [{ status: 429, error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }, "ai_quota", /credits/],
        [{ status: 404, error: { message: "The model does not exist", type: "invalid_request_error", code: "model_not_found" } }, "ai_model", /model/],
    ];

    for (const [plan, code, pattern] of cases) {
        const conversation = await newConversation(token);
        mock.handler = () => plan;
        const events = await readSSE(await chat(token, { conversationId: conversation.id, message: "Hello" }));
        const error = events.find((event) => event.event === "error");
        assert.ok(error, `expected an error event for ${code}`);
        assert.equal(error.data.code, code);
        assert.match(error.data.error, pattern);
        assert.doesNotMatch(error.data.error, /sk-/);

        // The question is kept so the student can retry with regenerate.
        const { data } = await api("GET", `/api/conversations/${conversation.id}`, { token });
        assert.deepEqual(data.conversation.messages.map((message) => message.role), ["user"]);
    }

    const status = await api("GET", "/api/status", { token });
    assert.equal(status.status, 200);
    assert.equal(typeof status.data.ai.ok, "boolean");
});

test("chat: an unreachable provider is reported as such", async () => {
    const { resetProvider } = require("../services/ai");
    const { token } = await register("Radia");
    const conversation = await newConversation(token);

    const original = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
    resetProvider();
    try {
        const events = await readSSE(await chat(token, { conversationId: conversation.id, message: "Hello?" }));
        assert.equal(events.find((event) => event.event === "error")?.data.code, "ai_unreachable");
    } finally {
        process.env.OPENAI_BASE_URL = original;
        resetProvider();
    }
});

test("materials: text is extracted, stored, and given to the tutor; unsupported files are refused", async () => {
    const { token } = await register("Rosalind");

    const form = new FormData();
    form.append("file", new Blob(["# Cell biology\n\nMitochondria produce ATP through cellular respiration."], { type: "text/markdown" }), "biology-notes.md");
    const upload = await api("POST", "/api/materials", { token, body: form });
    assert.equal(upload.status, 201, JSON.stringify(upload.data));
    assert.equal(upload.data.material.name, "biology-notes.md");
    assert.equal(upload.data.material.content, undefined);
    const materialId = upload.data.material.id;

    const conversation = await newConversation(token, { materialIds: [materialId] });
    mock.handler = () => ({ stream: ["Mitochondria make ATP."] });
    const events = await readSSE(await chat(token, { conversationId: conversation.id, message: "Summarize my notes" }));
    assert.deepEqual(events[0].data.materials.map((material) => material.name), ["biology-notes.md"]);
    assert.match(mock.requests.at(-1).messages[0].content, /Mitochondria produce ATP/);

    const legacy = new FormData();
    legacy.append("file", new Blob(["binary"]), "old.doc");
    const refused = await api("POST", "/api/materials", { token, body: legacy });
    assert.equal(refused.status, 415);

    const image = new FormData();
    image.append("file", new Blob(["PNG"]), "diagram.png");
    assert.equal((await api("POST", "/api/materials", { token, body: image })).status, 415);

    const other = await register("Eve");
    assert.equal((await api("GET", `/api/materials/${materialId}`, { token: other.token })).status, 404);

    const list = await api("GET", "/api/materials", { token });
    assert.equal(list.data.materials.length, 1);
    assert.equal((await api("DELETE", `/api/materials/${materialId}`, { token })).status, 200);
});

test("materials: a real PDF file is parsed", async () => {
    const { token } = await register("Dorothy");
    const pdf = buildMinimalPdf("Enzymes speed up reactions");
    const form = new FormData();
    form.append("file", new Blob([pdf], { type: "application/pdf" }), "enzymes.pdf");
    const upload = await api("POST", "/api/materials", { token, body: form });
    assert.equal(upload.status, 201, JSON.stringify(upload.data));

    const { data } = await api("GET", `/api/materials/${upload.data.material.id}`, { token });
    assert.match(data.material.content, /Enzymes speed up reactions/);
});

test("quizzes: generation hides answers, grading is server-side, short answers get AI feedback", async () => {
    const { token } = await register("Marie");

    mock.handler = (body) => {
        if (body.response_format?.type === "json_object" && /examiner/.test(body.messages[0].content)) {
            return { content: JSON.stringify({ results: [{ id: 1, verdict: "partial", feedback: "You named the gas but not where it comes from." }] }) };
        }
        return {
            content: JSON.stringify({
                title: "Photosynthesis basics",
                questions: [
                    { type: "multiple_choice", question: "Which gas do plants release?", options: ["Oxygen", "Nitrogen", "Helium", "Argon"], answerIndex: 0, explanation: "Oxygen is released when water is split." },
                    { type: "short_answer", question: "What gas do plants absorb?", answer: "Carbon dioxide from the air", explanation: "CO2 is fixed into sugar." },
                    { type: "multiple_choice", question: "Broken question", options: ["A", "A", "B", "C"], answerIndex: 0, explanation: "duplicate options are rejected" },
                ],
            }),
        };
    };

    const created = await api("POST", "/api/quizzes", { token, body: { topic: "Photosynthesis", level: "middle", count: 5, questionType: "mixed" } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const quiz = created.data.quiz;
    assert.equal(quiz.questions.length, 2, "invalid questions are dropped");
    assert.equal(quiz.questions[0].answerIndex, undefined, "answers must not reach the client before submission");
    assert.equal(quiz.questions[1].answer, undefined);

    const submitted = await api("POST", `/api/quizzes/${quiz.id}/submit`, { token, body: { responses: [{ choice: 1 }, { text: "CO2" }] } });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    assert.equal(submitted.data.quiz.status, "completed");
    assert.equal(submitted.data.quiz.score, 0.5);
    assert.equal(submitted.data.quiz.results[0].verdict, "incorrect");
    assert.equal(submitted.data.quiz.results[1].verdict, "partial");
    assert.equal(submitted.data.quiz.questions[0].answerIndex, 0);

    const again = await api("POST", `/api/quizzes/${quiz.id}/submit`, { token, body: { responses: [] } });
    assert.equal(again.status, 409);

    const stats = await api("GET", "/api/users/stats", { token });
    assert.equal(stats.data.stats.quizzesCompleted, 1);
    assert.equal(stats.data.stats.averageScore, 25);
    assert.equal(stats.data.stats.toReview[0].topic, "Photosynthesis");
    assert.equal(stats.data.stats.totalUsers, undefined, "stats must not expose site-wide data");

    mock.handler = () => ({ content: "Sorry, I cannot do that." });
    const unusable = await api("POST", "/api/quizzes", { token, body: { topic: "Anything" } });
    assert.equal(unusable.status, 502);
    assert.equal(unusable.data.code, "ai_bad_output");

    mock.handler = () => ({ status: 429, error: { code: "insufficient_quota", type: "insufficient_quota", message: "quota" } });
    const noCredits = await api("POST", "/api/quizzes", { token, body: { topic: "Anything" } });
    assert.equal(noCredits.status, 503);
    assert.equal(noCredits.data.code, "ai_quota");
});

test("notes: create, update, list, delete, and owner isolation", async () => {
    const { token } = await register("Hedy");
    const conversation = await newConversation(token);

    const created = await api("POST", "/api/notes", { token, body: { title: "Ohm's law", content: "V = IR", kind: "explanation", sourceConversationId: conversation.id } });
    assert.equal(created.status, 201);
    const id = created.data.note.id;
    assert.equal(created.data.note.sourceConversationId, conversation.id);

    const updated = await api("PATCH", `/api/notes/${id}`, { token, body: { content: "V = I × R" } });
    assert.equal(updated.data.note.content, "V = I × R");
    assert.equal(updated.data.note.title, "Ohm's law");

    assert.equal((await api("POST", "/api/notes", { token, body: { title: "", content: "x" } })).status, 400);

    const other = await register("Trudy");
    assert.equal((await api("PATCH", `/api/notes/${id}`, { token: other.token, body: { content: "hacked" } })).status, 404);

    assert.equal((await api("GET", "/api/notes", { token })).data.notes.length, 1);
    assert.equal((await api("DELETE", `/api/notes/${id}`, { token })).status, 200);
    assert.equal((await api("GET", "/api/notes", { token })).data.notes.length, 0);
});

test("conversations: rename, settings, import of browser-saved chats, delete", async () => {
    const { token } = await register("Lovelace");

    const imported = await api("POST", "/api/conversations/import", {
        token,
        body: {
            conversations: [
                { id: "legacy-1", title: "New chat", createdAt: 1700000000000, updatedAt: 1700000005000, messages: [
                    { role: "user", content: "What is a prime number?", createdAt: 1700000000000 },
                    { role: "assistant", content: "A number with exactly two divisors.", createdAt: 1700000001000 },
                    { role: "system", content: "should be dropped" },
                    { role: "assistant", content: "" },
                ] },
                { title: "Empty", messages: [] },
            ],
        },
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.data.imported.length, 1);
    assert.equal(imported.data.skipped, 1);
    assert.equal(imported.data.imported[0].title, "What is a prime number?");
    assert.match(imported.data.imported[0].preview, /two divisors/);

    const id = imported.data.imported[0].id;
    const full = await api("GET", `/api/conversations/${id}`, { token });
    assert.equal(full.data.conversation.messages.length, 2);

    const renamed = await api("PATCH", `/api/conversations/${id}`, { token, body: { title: "Primes", settings: { level: "primary", mode: "nonsense" } } });
    assert.equal(renamed.data.conversation.title, "Primes");
    assert.equal(renamed.data.conversation.settings.level, "primary");
    assert.equal(renamed.data.conversation.settings.mode, "explain", "unknown modes fall back to the default");

    assert.equal((await api("DELETE", `/api/conversations/${id}`, { token })).status, 200);
    assert.equal((await api("GET", `/api/conversations/${id}`, { token })).status, 404);
    assert.equal((await api("GET", "/api/conversations/not-a-uuid", { token })).status, 404);
});

/* A one-page PDF with a single line of text, built by hand so the test needs no fixtures. */
function buildMinimalPdf(text) {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
}
