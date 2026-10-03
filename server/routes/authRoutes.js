const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");
const {
    findMemoryUserByEmail,
    createMemoryUser,
    getMemoryUserById,
    toPublicUser,
} = require("../utils/fallbackStore");

const router = express.Router();

function useInMemoryStore() {
    return !process.env.DATABASE_URL && !process.env.POSTGRES_URL;
}

function signToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
        },
        process.env.JWT_SECRET || "dev-secret-change-me",
        { expiresIn: "7d" }
    );
}

router.post(
    "/register",
    [
        body("name").trim().notEmpty().withMessage("Name is required."),
        body("email").isEmail().withMessage("A valid email is required."),
        body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const { name, email, password } = req.body;
            const normalizedEmail = email.trim().toLowerCase();

            if (useInMemoryStore()) {
                const existing = findMemoryUserByEmail(normalizedEmail);
                if (existing) {
                    return res.status(409).json({ success: false, error: "An account with this email already exists." });
                }

                const passwordHash = await bcrypt.hash(password, 10);
                const user = createMemoryUser({
                    name,
                    email: normalizedEmail,
                    passwordHash,
                });

                const token = signToken(user);
                return res.status(201).json({
                    success: true,
                    token,
                    user: toPublicUser(user),
                });
            }

            const existing = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
            if (existing.rows.length) {
                return res.status(409).json({ success: false, error: "An account with this email already exists." });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const result = await query(
                "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role, created_at",
                [name.trim(), normalizedEmail, passwordHash]
            );

            const user = result.rows[0];
            const token = signToken(user);

            return res.status(201).json({
                success: true,
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    "/login",
    [
        body("email").isEmail().withMessage("A valid email is required."),
        body("password").notEmpty().withMessage("Password is required."),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const { email, password } = req.body;
            const normalizedEmail = email.trim().toLowerCase();

            if (useInMemoryStore()) {
                const user = findMemoryUserByEmail(normalizedEmail);
                if (!user) {
                    return res.status(401).json({ success: false, error: "Invalid credentials." });
                }

                const valid = await bcrypt.compare(password, user.password_hash);
                if (!valid) {
                    return res.status(401).json({ success: false, error: "Invalid credentials." });
                }

                const token = signToken(user);
                return res.json({
                    success: true,
                    token,
                    user: toPublicUser(user),
                });
            }

            const result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
            const user = result.rows[0];

            if (!user) {
                return res.status(401).json({ success: false, error: "Invalid credentials." });
            }

            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) {
                return res.status(401).json({ success: false, error: "Invalid credentials." });
            }

            const token = signToken(user);
            return res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

router.get("/me", authenticateToken, async (req, res, next) => {
    try {
        if (useInMemoryStore()) {
            const user = getMemoryUserById(req.user.id);
            if (!user) {
                return res.status(404).json({ success: false, error: "User not found." });
            }

            return res.json({ success: true, user: toPublicUser(user) });
        }

        const result = await query("SELECT id, name, email, role, created_at FROM users WHERE id = $1", [req.user.id]);
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: "User not found." });
        }

        return res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
