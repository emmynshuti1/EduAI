function notFoundHandler(req, res) {
    res.status(404).json({ success: false, error: "Route not found." });
}

class HttpError extends Error {
    constructor(statusCode, message, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    if (err.type === "entity.too.large") {
        return res.status(413).json({ success: false, error: "The request is too large." });
    }

    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, error: "The request body is not valid JSON." });
    }

    if (err.name === "MulterError") {
        const message = err.code === "LIMIT_FILE_SIZE" ? "That file is too large. The limit is 10 MB." : "The upload could not be processed.";
        return res.status(400).json({ success: false, error: message });
    }

    const statusCode = err.statusCode || err.status || 500;

    // Only messages we created on purpose reach the client; internals stay in the log.
    if (statusCode >= 500 && !(err instanceof HttpError) && err.name !== "AIError") {
        console.error("Unhandled error:", err);
        return res.status(500).json({ success: false, error: "Something went wrong on the server. Please try again." });
    }

    res.status(statusCode).json({
        success: false,
        code: err.code,
        error: err.message,
    });
}

module.exports = {
    HttpError,
    notFoundHandler,
    errorHandler,
};
