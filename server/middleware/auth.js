const jwt = require("jsonwebtoken");

const PLACEHOLDER_SECRETS = new Set(["", "change_this_to_a_strong_secret", "dev-secret-change-me"]);

function getJwtSecret() {
    return process.env.JWT_SECRET || "dev-secret-change-me";
}

/* Refuse to run in production with a guessable signing secret. */
function assertJwtSecret() {
    const secret = process.env.JWT_SECRET || "";
    const weak = PLACEHOLDER_SECRETS.has(secret) || secret.length < 32;

    if (weak && process.env.NODE_ENV === "production") {
        throw new Error("JWT_SECRET must be set to a random value of at least 32 characters in production.");
    }

    if (weak) {
        console.warn("Warning: JWT_SECRET is missing or weak. Set a long random value in server/.env before deploying.");
    }
}

function signToken(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role }, getJwtSecret(), { expiresIn: "7d" });
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, code: "auth_required", error: "Please log in to continue." });
    }

    try {
        req.user = jwt.verify(token, getJwtSecret());
        next();
    } catch (error) {
        return res.status(401).json({ success: false, code: "auth_expired", error: "Your session has expired. Please log in again." });
    }
}

module.exports = {
    authenticateToken,
    assertJwtSecret,
    signToken,
};
