const { query, pool } = require("../config/db");
const { initializeDatabase } = require("../utils/dbInit");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
const ms = (value) => (value ? new Date(value).getTime() : null);

const mapUser = (row) => row && {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role || "student",
    createdAt: ms(row.created_at),
    passwordHash: row.password_hash,
};

const mapMessage = (row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    meta: row.meta || {},
    createdAt: ms(row.created_at),
});

const mapConversation = (row) => ({
    id: row.id,
    title: row.title,
    settings: row.settings || {},
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    messageCount: row.message_count !== undefined ? Number(row.message_count) : undefined,
    preview: row.preview ?? undefined,
});

const mapMaterial = (row, withContent = false) => ({
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    charCount: row.char_count || 0,
    truncated: Boolean(row.truncated),
    createdAt: ms(row.created_at),
    ...(withContent ? { content: row.content || "" } : {}),
});

const mapNote = (row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    kind: row.kind,
    sourceConversationId: row.source_conversation_id,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
});

const mapQuiz = (row) => ({
    id: row.id,
    topic: row.topic,
    title: row.title,
    level: row.level,
    sourceLabel: row.source_label,
    questions: row.questions || [],
    responses: row.responses,
    results: row.results,
    score: row.score === null ? null : Number(row.score),
    total: row.total,
    status: row.status,
    createdAt: ms(row.created_at),
    completedAt: ms(row.completed_at),
});

const mapSession = (row) => ({
    id: row.id,
    topic: row.topic,
    notes: row.notes,
    status: row.status,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
});

function createPgStore() {
    return {
        kind: "postgres",

        async init() {
            await initializeDatabase();
        },

        async close() {
            await pool.end();
        },

        /* Users */
        async findUserByEmail(email) {
            const result = await query("SELECT * FROM users WHERE email = $1", [email]);
            return mapUser(result.rows[0]) || null;
        },

        async getUserById(id) {
            if (!isUuid(id)) return null;
            const result = await query("SELECT * FROM users WHERE id = $1", [id]);
            return mapUser(result.rows[0]) || null;
        },

        async createUser({ name, email, passwordHash }) {
            const result = await query(
                "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
                [name, email, passwordHash]
            );
            return mapUser(result.rows[0]);
        },

        /* Conversations */
        async listConversations(userId) {
            const result = await query(
                `SELECT c.*,
                        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                        (SELECT LEFT(m.content, 160) FROM messages m WHERE m.conversation_id = c.id
                          ORDER BY m.created_at DESC, m.seq DESC LIMIT 1) AS preview
                 FROM conversations c
                 WHERE c.user_id = $1
                 ORDER BY c.updated_at DESC`,
                [userId]
            );
            return result.rows.map(mapConversation);
        },

        async getConversation(userId, id) {
            if (!isUuid(id)) return null;
            const result = await query("SELECT * FROM conversations WHERE id = $1 AND user_id = $2", [id, userId]);
            if (!result.rows[0]) return null;
            const messages = await query(
                "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, seq ASC",
                [id]
            );
            return { ...mapConversation(result.rows[0]), messages: messages.rows.map(mapMessage) };
        },

        async createConversation(userId, { title, settings }) {
            const result = await query(
                "INSERT INTO conversations (user_id, title, settings) VALUES ($1, $2, $3) RETURNING *",
                [userId, title, settings || {}]
            );
            return { ...mapConversation(result.rows[0]), messages: [] };
        },

        async updateConversation(userId, id, { title, settings }) {
            if (!isUuid(id)) return null;
            const result = await query(
                `UPDATE conversations
                 SET title = COALESCE($3, title), settings = COALESCE($4, settings), updated_at = NOW()
                 WHERE id = $1 AND user_id = $2 RETURNING *`,
                [id, userId, title ?? null, settings ?? null]
            );
            return result.rows[0] ? mapConversation(result.rows[0]) : null;
        },

        async deleteConversation(userId, id) {
            if (!isUuid(id)) return false;
            const result = await query("DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
            return Boolean(result.rows[0]);
        },

        async addMessage(conversationId, { role, content, meta = {}, createdAt }) {
            const result = await query(
                `INSERT INTO messages (conversation_id, role, content, meta, created_at)
                 VALUES ($1, $2, $3, $4, COALESCE($5, NOW())) RETURNING *`,
                [conversationId, role, content, meta, createdAt ? new Date(createdAt) : null]
            );
            await query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [conversationId]);
            return mapMessage(result.rows[0]);
        },

        async deleteMessage(conversationId, messageId) {
            if (!isUuid(messageId)) return false;
            const result = await query(
                "DELETE FROM messages WHERE id = $1 AND conversation_id = $2 RETURNING id",
                [messageId, conversationId]
            );
            return Boolean(result.rows[0]);
        },

        async importConversation(userId, { title, settings, createdAt, updatedAt, messages }) {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                const created = await client.query(
                    `INSERT INTO conversations (user_id, title, settings, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                    [userId, title, settings || {}, new Date(createdAt), new Date(updatedAt)]
                );
                const conversation = created.rows[0];
                for (const message of messages) {
                    await client.query(
                        "INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES ($1, $2, $3, $4, $5)",
                        [conversation.id, message.role, message.content, message.meta || {}, new Date(message.createdAt)]
                    );
                }
                await client.query("COMMIT");
                return {
                    ...mapConversation(conversation),
                    messageCount: messages.length,
                    preview: messages[messages.length - 1].content.slice(0, 160),
                };
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        },

        /* Materials (stored in the existing uploaded_files table) */
        async listMaterials(userId) {
            const result = await query(
                `SELECT id, original_name, mime_type, size_bytes, char_count, truncated, created_at
                 FROM uploaded_files WHERE user_id = $1 AND content IS NOT NULL ORDER BY created_at DESC`,
                [userId]
            );
            return result.rows.map((row) => mapMaterial(row));
        },

        async getMaterials(userId, ids) {
            const valid = ids.filter(isUuid);
            if (!valid.length) return [];
            const result = await query(
                "SELECT * FROM uploaded_files WHERE user_id = $1 AND id = ANY($2::uuid[]) AND content IS NOT NULL",
                [userId, valid]
            );
            return result.rows.map((row) => mapMaterial(row, true));
        },

        async createMaterial(userId, { name, mimeType, sizeBytes, content, truncated }) {
            const result = await query(
                `INSERT INTO uploaded_files (user_id, filename, original_name, mime_type, size_bytes, storage_path, content, char_count, truncated)
                 VALUES ($1, $2, $2, $3, $4, NULL, $5, $6, $7) RETURNING *`,
                [userId, name, mimeType, sizeBytes, content, content.length, truncated]
            );
            return mapMaterial(result.rows[0]);
        },

        async deleteMaterial(userId, id) {
            if (!isUuid(id)) return false;
            const result = await query("DELETE FROM uploaded_files WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
            return Boolean(result.rows[0]);
        },

        /* Notes */
        async listNotes(userId) {
            const result = await query("SELECT * FROM study_notes WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
            return result.rows.map(mapNote);
        },

        async getNote(userId, id) {
            if (!isUuid(id)) return null;
            const result = await query("SELECT * FROM study_notes WHERE id = $1 AND user_id = $2", [id, userId]);
            return result.rows[0] ? mapNote(result.rows[0]) : null;
        },

        async createNote(userId, { title, content, kind, sourceConversationId }) {
            const result = await query(
                `INSERT INTO study_notes (user_id, title, content, kind, source_conversation_id)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [userId, title, content, kind, isUuid(sourceConversationId) ? sourceConversationId : null]
            );
            return mapNote(result.rows[0]);
        },

        async updateNote(userId, id, { title, content }) {
            if (!isUuid(id)) return null;
            const result = await query(
                `UPDATE study_notes SET title = COALESCE($3, title), content = COALESCE($4, content), updated_at = NOW()
                 WHERE id = $1 AND user_id = $2 RETURNING *`,
                [id, userId, title ?? null, content ?? null]
            );
            return result.rows[0] ? mapNote(result.rows[0]) : null;
        },

        async deleteNote(userId, id) {
            if (!isUuid(id)) return false;
            const result = await query("DELETE FROM study_notes WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
            return Boolean(result.rows[0]);
        },

        /* Quizzes */
        async listQuizzes(userId) {
            const result = await query("SELECT * FROM quizzes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [userId]);
            return result.rows.map(mapQuiz);
        },

        async getQuiz(userId, id) {
            if (!isUuid(id)) return null;
            const result = await query("SELECT * FROM quizzes WHERE id = $1 AND user_id = $2", [id, userId]);
            return result.rows[0] ? mapQuiz(result.rows[0]) : null;
        },

        async createQuiz(userId, { topic, title, level, sourceLabel, questions }) {
            const result = await query(
                `INSERT INTO quizzes (user_id, topic, title, level, source_label, questions, total)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [userId, topic, title, level, sourceLabel, JSON.stringify(questions), questions.length]
            );
            return mapQuiz(result.rows[0]);
        },

        async completeQuiz(userId, id, { responses, results, score }) {
            if (!isUuid(id)) return null;
            const result = await query(
                `UPDATE quizzes SET responses = $3, results = $4, score = $5, status = 'completed', completed_at = NOW()
                 WHERE id = $1 AND user_id = $2 RETURNING *`,
                [id, userId, JSON.stringify(responses), JSON.stringify(results), score]
            );
            return result.rows[0] ? mapQuiz(result.rows[0]) : null;
        },

        async deleteQuiz(userId, id) {
            if (!isUuid(id)) return false;
            const result = await query("DELETE FROM quizzes WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
            return Boolean(result.rows[0]);
        },

        /* Study sessions (original API, kept for compatibility) */
        async listStudySessions(userId) {
            const result = await query("SELECT * FROM study_sessions WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
            return result.rows.map(mapSession);
        },

        async createStudySession(userId, { topic, notes, status }) {
            const result = await query(
                "INSERT INTO study_sessions (user_id, topic, notes, status) VALUES ($1, $2, $3, $4) RETURNING *",
                [userId, topic, notes, status]
            );
            return mapSession(result.rows[0]);
        },

        /* Progress */
        async getStats(userId) {
            const [conversations, messages, notes, materials] = await Promise.all([
                query("SELECT COUNT(*)::int AS n FROM conversations WHERE user_id = $1", [userId]),
                query(
                    `SELECT COUNT(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
                     WHERE c.user_id = $1 AND m.role = 'user'`,
                    [userId]
                ),
                query("SELECT COUNT(*)::int AS n FROM study_notes WHERE user_id = $1", [userId]),
                query("SELECT COUNT(*)::int AS n FROM uploaded_files WHERE user_id = $1 AND content IS NOT NULL", [userId]),
            ]);
            return {
                conversations: conversations.rows[0].n,
                questionsAsked: messages.rows[0].n,
                notes: notes.rows[0].n,
                materials: materials.rows[0].n,
            };
        },
    };
}

module.exports = { createPgStore, isUuid };
