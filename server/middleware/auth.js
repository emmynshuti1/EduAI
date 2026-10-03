const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, error: "Authentication token is required." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret-change-me");
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: "Invalid or expired token." });
    }
}

module.exports = {
    authenticateToken,
};
