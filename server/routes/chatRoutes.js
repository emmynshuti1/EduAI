const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { aiLimiter } = require("../middleware/rateLimits");
const { sendMessage } = require("../controllers/chatController");

const router = express.Router();

router.post("/", authenticateToken, aiLimiter, sendMessage);

module.exports = router;
