const express = require("express");
const multer = require("multer");
const { getStore } = require("../store");
const { authenticateToken } = require("../middleware/auth");
const { extractText } = require("../services/extractText");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function cleanFileName(name) {
    // Multer decodes multipart filenames as latin1; recover UTF-8 names.
    const decoded = Buffer.from(String(name || "material"), "latin1").toString("utf8");
    return decoded.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200) || "material";
}

async function handleUpload(req, res, next) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "Choose a file to upload." });
        }

        const name = cleanFileName(req.file.originalname);
        const { content, truncated } = await extractText({ ...req.file, originalname: name });
        const material = await getStore().createMaterial(req.user.id, {
            name,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            content,
            truncated,
        });

        res.status(201).json({ success: true, material, file: material });
    } catch (error) {
        next(error);
    }
}

router.use(authenticateToken);

router.get("/", async (req, res, next) => {
    try {
        res.json({ success: true, materials: await getStore().listMaterials(req.user.id) });
    } catch (error) {
        next(error);
    }
});

router.post("/", upload.single("file"), handleUpload);

router.get("/:id", async (req, res, next) => {
    try {
        const [material] = await getStore().getMaterials(req.user.id, [req.params.id]);
        if (!material) return res.status(404).json({ success: false, error: "Material not found." });
        res.json({ success: true, material });
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", async (req, res, next) => {
    try {
        const deleted = await getStore().deleteMaterial(req.user.id, req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: "Material not found." });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = { router, upload, handleUpload };
