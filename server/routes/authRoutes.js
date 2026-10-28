const express = require("express");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const { getStore } = require("../store");
const { authenticateToken, signToken } = require("../middleware/auth");

const router = express.Router();

function toPublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "student",
        createdAt: user.createdAt,
    };
}

function firstValidationError(req) {
    const errors = validationResult(req);
    return errors.isEmpty() ? null : errors.array()[0].msg;
}

router.post(
    "/register",
    [
        body("name").isString().trim().isLength({ min: 1, max: 80 }).withMessage("Please enter your name (up to 80 characters)."),
        body("email").isString().trim().isEmail().isLength({ max: 255 }).withMessage("Please enter a valid email address."),
        body("password").isString().isLength({ min: 8, max: 200 }).withMessage("Password must be at least 8 characters."),
    ],
    async (req, res, next) => {
        try {
            const validationError = firstValidationError(req);
            if (validationError) {
                return res.status(400).json({ success: false, error: validationError });
            }

            const store = getStore();
            const name = req.body.name.trim();
            const email = req.body.email.trim().toLowerCase();

            if (await store.findUserByEmail(email)) {
                return res.status(409).json({ success: false, error: "An account with this email already exists. Try logging in." });
            }

            const passwordHash = await bcrypt.hash(req.body.password, 10);
            const user = await store.createUser({ name, email, passwordHash });

            return res.status(201).json({ success: true, token: signToken(user), user: toPublicUser(user) });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).json({ success: false, error: "An account with this email already exists. Try logging in." });
            }
            next(error);
        }
    }
);

router.post(
    "/login",
    [
        body("email").isString().trim().isEmail().withMessage("Please enter a valid email address."),
        body("password").isString().notEmpty().isLength({ max: 200 }).withMessage("Please enter your password."),
    ],
    async (req, res, next) => {
        try {
            const validationError = firstValidationError(req);
            if (validationError) {
                return res.status(400).json({ success: false, error: validationError });
            }

            const user = await getStore().findUserByEmail(req.body.email.trim().toLowerCase());
            const valid = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;

            if (!valid) {
                return res.status(401).json({ success: false, error: "Incorrect email or password." });
            }

            return res.json({ success: true, token: signToken(user), user: toPublicUser(user) });
        } catch (error) {
            next(error);
        }
    }
);

router.get("/me", authenticateToken, async (req, res, next) => {
    try {
        const user = await getStore().getUserById(req.user.id);
        if (!user) {
            return res.status(401).json({ success: false, code: "auth_expired", error: "Your account could not be found. Please log in again." });
        }

        return res.json({ success: true, user: toPublicUser(user) });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
