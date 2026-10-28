const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const express = require("express");
const cors = require("cors");

const chatRoutes = require("./routes/chatRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const studyRoutes = require("./routes/studyRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const { router: materialRoutes } = require("./routes/materialRoutes");
const noteRoutes = require("./routes/noteRoutes");
const quizRoutes = require("./routes/quizRoutes");
const statusRoutes = require("./routes/statusRoutes");
const { getStore } = require("./store");
const { getAIStatus } = require("./services/ai");
const { assertJwtSecret } = require("./middleware/auth");
const { apiLimiter, authLimiter } = require("./middleware/rateLimits");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const CLIENT_DIR = path.join(__dirname, "..", "client");
const isProduction = process.env.NODE_ENV === "production";

/* Third-party browser libraries are served from installed packages, so no CDN is needed. */
const packageFile = (name, file) => path.join(__dirname, "node_modules", name, file);
const VENDOR_FILES = {
    "marked.js": packageFile("marked", "lib/marked.umd.js"),
    "purify.js": packageFile("dompurify", "dist/purify.min.js"),
    "highlight.js": packageFile("@highlightjs/cdn-assets", "highlight.min.js"),
    "highlight.css": packageFile("@highlightjs/cdn-assets", "styles/github-dark.min.css"),
};

function allowedOrigins() {
    const configured = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    return new Set(configured);
}

function isAllowedOrigin(origin, configured) {
    if (!origin) return true;
    if (configured.has(origin)) return true;
    // During development the client may also be opened from a local static server.
    return !isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function securityHeaders(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
        ].join("; ")
    );
    next();
}

function createApp() {
    const app = express();
    const origins = allowedOrigins();

    app.disable("x-powered-by");
    if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);

    app.use(securityHeaders);

    app.get("/health", (req, res) => {
        res.json({ success: true, status: "ok", service: "EduAI API" });
    });

    app.get("/vendor/:file", (req, res, next) => {
        const file = VENDOR_FILES[req.params.file];
        if (!file) return next();
        res.sendFile(file, { maxAge: isProduction ? "7d" : 0 });
    });

    app.use(express.static(CLIENT_DIR, { maxAge: isProduction ? "1h" : 0 }));

    app.use("/api", cors({
        origin: (origin, callback) => callback(null, isAllowedOrigin(origin, origins)),
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    }));
    app.use("/api", apiLimiter);
    app.use("/api", express.json({ limit: "2mb" }));

    app.use("/api/auth/login", authLimiter);
    app.use("/api/auth/register", authLimiter);
    app.use("/api/auth", authRoutes);
    app.use("/api/users", userRoutes);
    app.use("/api/study", studyRoutes);
    app.use("/api/conversations", conversationRoutes);
    app.use("/api/chat", chatRoutes);
    app.use("/api/materials", materialRoutes);
    app.use("/api/notes", noteRoutes);
    app.use("/api/quizzes", quizRoutes);
    app.use("/api/status", statusRoutes);

    app.get("/api", (req, res) => {
        res.json({
            message: "EduAI API is running.",
            api: {
                auth: "/api/auth/register, /api/auth/login, /api/auth/me",
                users: "/api/users/profile, /api/users/stats",
                conversations: "/api/conversations",
                chat: "/api/chat (Server-Sent Events)",
                materials: "/api/materials",
                notes: "/api/notes",
                quizzes: "/api/quizzes",
                status: "/api/status",
                study: "/api/study/upload-notes, /api/study/sessions",
            },
        });
    });

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

async function startServer() {
    const PORT = Number(process.env.PORT) || 5000;

    try {
        assertJwtSecret();
        await getStore().init();
    } catch (error) {
        console.error(`Failed to start EduAI: ${error.message}`);
        if (process.env.DATABASE_URL) {
            console.error("Check that PostgreSQL is running (docker compose up -d) and DATABASE_URL in server/.env is correct, or remove DATABASE_URL to use local file storage.");
        }
        process.exit(1);
    }

    const server = createApp().listen(PORT, () => {
        console.log(`EduAI is running at http://localhost:${PORT}`);
    });

    // Report AI credential problems at startup instead of on a student's first question.
    getAIStatus({ force: true })
        .then((status) => {
            if (status.ok) {
                console.log(`AI provider ready: ${status.provider} (${status.model}).`);
            } else {
                console.warn(`AI provider unavailable [${status.code}]: ${status.message}`);
            }
        })
        .catch((error) => console.warn("AI status check failed:", error.message));

    async function shutdown(signal) {
        console.log(`${signal} received, shutting down.`);
        server.close();
        await getStore().close?.().catch(() => {});
        process.exit(0);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
    startServer();
}

module.exports = { createApp, startServer };
