const path = require("path");
const { HttpError } = require("../middleware/errorHandler");

/* Extracts readable text from uploaded study material. Only text that was really extracted is ever shown to the AI. */

const MAX_STORED_CHARS = 200000;

const TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".css",
    ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go",
    ".rb", ".php", ".rs", ".kt", ".swift", ".sql", ".sh", ".yaml", ".yml", ".tex", ".r", ".m",
]);

const SUPPORTED_DESCRIPTION = "PDF, DOCX, TXT, Markdown, CSV, or source code files";

function normalizeText(text) {
    return String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u0000/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

async function extractPdf(buffer) {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return result.text;
    } catch (error) {
        if (error?.name === "PasswordException") {
            throw new HttpError(422, "This PDF is password-protected. Remove the password and upload it again.");
        }
        throw new HttpError(422, "This PDF could not be read. It may be damaged or use an unsupported format.");
    } finally {
        await parser.destroy().catch(() => {});
    }
}

async function extractDocx(buffer) {
    const mammoth = require("mammoth");
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } catch {
        throw new HttpError(422, "This Word document could not be read. Try saving it again as .docx or PDF.");
    }
}

async function extractText(file) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    let text;

    if (extension === ".pdf") {
        text = await extractPdf(file.buffer);
    } else if (extension === ".docx") {
        text = await extractDocx(file.buffer);
    } else if (TEXT_EXTENSIONS.has(extension)) {
        text = file.buffer.toString("utf8");
    } else if (extension === ".doc") {
        throw new HttpError(415, "Older .doc files are not supported. Save the document as .docx or PDF and upload it again.");
    } else {
        throw new HttpError(415, `This file type is not supported. Upload ${SUPPORTED_DESCRIPTION}.`);
    }

    const content = normalizeText(text);
    if (!content) {
        throw new HttpError(
            422,
            extension === ".pdf"
                ? "No text could be found in this PDF. It is probably a scanned image, which EduAI cannot read yet. Try a text-based PDF or paste the text."
                : "This file does not contain any readable text."
        );
    }

    return {
        content: content.slice(0, MAX_STORED_CHARS),
        truncated: content.length > MAX_STORED_CHARS,
    };
}

module.exports = { extractText, SUPPORTED_DESCRIPTION };
