const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const chatRoutes = require("./routes/chatRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const studyRoutes = require("./routes/studyRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const { initializeDatabase } = require("./utils/dbInit");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

const customOrigins = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "null",
];

const configuredOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = [...new Set([...customOrigins, ...configuredOrigins])];

function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (origin === "null") return true;
    return origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
}

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests. Please slow down." },
});

app.use(cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            callback(null, origin || true);
            return;
        }

        callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Origin"],
}));
app.use(express.json({ limit: "5mb" }));
app.use(apiLimiter);

app.use(express.static("../client"));

app.get("/health", (req, res) => {
    res.json({ success: true, status: "ok", service: "EduAI API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/study", studyRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/chat", chatRoutes);

app.get("/", (req, res) => {
    res.sendFile(require("path").join(__dirname, "../client/index.html"));
});

app.get("/api", (req, res) => {
    res.json({
        message: "EduAI Backend is running successfully!",
        api: {
            auth: "/api/auth/register, /api/auth/login, /api/auth/me",
            users: "/api/users/profile, /api/users/stats",
            conversations: "/api/conversations",
            chat: "/api/chat",
            study: "/api/study/upload-notes, /api/study/sessions",
        },
    });
});

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
    try {
        if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
            await initializeDatabase();
        } else {
            console.log("No DATABASE_URL configured; skipping database initialization.");
        }

        app.listen(PORT, () => {
            console.log(`Server is running on port http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

startServer();