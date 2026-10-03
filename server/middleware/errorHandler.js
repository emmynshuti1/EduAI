function notFoundHandler(req, res) {
    res.status(404).json({ success: false, error: "Route not found." });
}

function errorHandler(err, req, res, next) {
    console.error("Unhandled error:", err);

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal server error.";

    res.status(statusCode).json({
        success: false,
        error: message,
    });
}

module.exports = {
    notFoundHandler,
    errorHandler,
};
