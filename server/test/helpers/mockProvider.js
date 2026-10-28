const http = require("http");

/*
 * Minimal OpenAI-compatible Chat Completions server for tests.
 * `state.handler(body)` decides the response; every request body is recorded.
 */
function startMockProvider() {
    const state = {
        requests: [],
        handler: () => ({ stream: ["Hello", " student"] }),
    };

    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", async () => {
            const body = raw ? JSON.parse(raw) : {};
            state.requests.push(body);
            const plan = await state.handler(body);

            if (plan.status) {
                res.writeHead(plan.status, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: plan.error }));
                return;
            }

            if (body.stream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                let closed = false;
                res.on("close", () => { closed = true; state.lastStreamClosedEarly = !res.writableFinished; });

                for (const piece of plan.stream || []) {
                    if (closed) return;
                    res.write(`data: ${JSON.stringify({
                        id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: body.model,
                        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
                    })}\n\n`);
                    if (plan.delayMs) await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
                }
                if (closed) return;
                res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
                res.end("data: [DONE]\n\n");
                return;
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                id: "chatcmpl-test", object: "chat.completion", created: 1, model: body.model,
                choices: [{ index: 0, message: { role: "assistant", content: plan.content ?? "" }, finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
        });
    });

    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            state.url = `http://127.0.0.1:${server.address().port}/v1`;
            state.close = () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); });
            resolve(state);
        });
    });
}

module.exports = { startMockProvider };
