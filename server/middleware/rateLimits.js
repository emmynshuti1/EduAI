const rateLimit = require("express-rate-limit");

const json = (error) => ({ success: false, code: "rate_limited", error });

/* Broad protection for the whole API, per IP. */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT) || 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: json("Too many requests. Please slow down and try again in a few minutes."),
});

/* Slows down password guessing, per IP. */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT) || 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: json("Too many sign-in attempts. Please wait 15 minutes and try again."),
});

/* Protects AI credits, per signed-in user. Must run after authenticateToken. */
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: json("You're sending requests very quickly. Take a breath and try again in a minute."),
});

module.exports = { apiLimiter, authLimiter, aiLimiter };
