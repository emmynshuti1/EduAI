const OpenAI = require("openai");

const OPENAI_MODEL =
    process.env.OPENAI_MODEL ||
    "gpt-4.1-mini";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 10 * 60 * 1000,
    maxRetries: 0
});


const SYSTEM_INSTRUCTIONS = `
You are EduAI, a modern AI study assistant.

Your main purpose is helping students understand and learn.

Behavior:
- Be accurate, helpful, and clear.
- Explain difficult concepts step by step.
- Use simple language when appropriate.
- Do not unnecessarily repeat the question.
- Use Markdown when it improves readability.
- Use fenced code blocks for programming code.
- Explain important parts of programming code.
- Encourage understanding instead of simply giving answers.
- Ask a short clarification question if a request is genuinely ambiguous.
- Keep answers focused unless the user asks for more detail.
- Use headings, bullet points, numbered lists, tables, and examples when useful.
- When solving a problem, explain the reasoning clearly.
- Never pretend to have performed an action you did not perform.

You can help with:
- Programming
- Mathematics
- Science
- History
- English
- Computer science
- Networking
- Databases
- Web development
- Mobile development
- General education
`;


const sendMessage = async (req, res) => {

    const controller =
        new AbortController();

    let clientAborted = false;


    /*
     * Only treat the request as aborted when
     * Node explicitly tells us the request was aborted.
     */
    req.on("aborted", () => {

        clientAborted = true;

        controller.abort();

        console.log(
            "EduAI request aborted by client."
        );
    });


    try {

        const {
            message,
            previousResponseId
        } = req.body;


        if (
            !process.env.OPENAI_API_KEY
        ) {

            return res.status(500).json({
                success: false,
                error: "OPENAI_API_KEY is not configured."
            });
        }


        if (
            !message ||
            !message.trim()
        ) {

            return res.status(400).json({
                success: false,
                error: "Message is required."
            });
        }


        /*
         * SSE headers
         */
        res.setHeader(
            "Content-Type",
            "text/event-stream; charset=utf-8"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache, no-transform"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        res.setHeader(
            "X-Accel-Buffering",
            "no"
        );


        if (res.flushHeaders) {
            res.flushHeaders();
        }


        /*
         * OpenAI request
         */
        const request = {

            model: OPENAI_MODEL,

            instructions:
                SYSTEM_INSTRUCTIONS,

            input:
                message.trim(),

            stream: true
        };


        if (previousResponseId) {

            request.previous_response_id =
                previousResponseId;
        }


        console.log(
            "EduAI request:",
            message.substring(0, 80)
        );


        const stream =
            await openai.responses.create(
                request,
                {
                    signal:
                        controller.signal
                }
            );


        let responseId = null;


        /*
         * Process OpenAI stream
         */
        for await (
            const event of stream
        ) {

            /*
             * Response created
             */
            if (
                event.type ===
                "response.created"
            ) {

                responseId =
                    event.response?.id ||
                    null;


                sendSSE(
                    res,
                    "response_id",
                    {
                        responseId
                    }
                );
            }


            /*
             * Text delta
             */
            else if (
                event.type ===
                "response.output_text.delta"
            ) {

                sendSSE(
                    res,
                    "message",
                    {
                        text:
                            event.delta || ""
                    }
                );
            }


            /*
             * Completed
             */
            else if (
                event.type ===
                "response.completed"
            ) {

                responseId =
                    event.response?.id ||
                    responseId;


                sendSSE(
                    res,
                    "done",
                    {
                        responseId
                    }
                );
            }


            /*
             * OpenAI error
             */
            else if (
                event.type ===
                "error"
            ) {

                sendSSE(
                    res,
                    "error",
                    {
                        error:
                            event.error?.message ||
                            "OpenAI returned an error."
                    }
                );
            }
        }


        /*
         * Normal completion
         */
        if (!res.writableEnded) {

            res.end();
        }

    } catch (error) {

        /*
         * User stopped/aborted generation.
         */
        if (
            error?.name === "AbortError" ||
            controller.signal.aborted ||
            clientAborted
        ) {

            console.log(
                "EduAI generation stopped."
            );


            if (!res.writableEnded) {
                res.end();
            }


            return;
        }


        console.error(
            "OpenAI Error:",
            error
        );


        /*
         * Normal HTTP error
         */
        if (!res.headersSent) {

            return res.status(500).json({

                success: false,

                error:
                    error.message ||
                    "Failed to get a response from EduAI."
            });
        }


        /*
         * SSE error
         */
        if (!res.writableEnded) {

            sendSSE(
                res,
                "error",
                {
                    error:
                        error.message ||
                        "Failed to get a response from EduAI."
                }
            );


            res.end();
        }
    }
};


/*
 * Send SSE event
 */
function sendSSE(
    res,
    event,
    data
) {

    if (res.writableEnded) {
        return;
    }


    res.write(
        `event: ${event}\n` +
        `data: ${JSON.stringify(data)}\n\n`
    );
}


module.exports = {
    sendMessage
};