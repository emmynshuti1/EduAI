const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/*
 * Development fallback used when no DATABASE_URL is configured. Data is kept in memory
 * and written atomically to a JSON file, so it survives server restarts.
 */
const COLLECTIONS = ["users", "conversations", "messages", "materials", "notes", "quizzes", "studySessions"];

function createFileStore({ filePath }) {
    let data = Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
    let writeTimer = null;
    let writing = Promise.resolve();

    const now = () => Date.now();
    const newId = () => crypto.randomUUID();
    const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

    function persistSoon() {
        clearTimeout(writeTimer);
        writeTimer = setTimeout(flush, 150);
    }

    function flush() {
        clearTimeout(writeTimer);
        const snapshot = JSON.stringify(data);
        writing = writing.then(async () => {
            const temp = `${filePath}.${process.pid}.tmp`;
            await fs.promises.writeFile(temp, snapshot, "utf8");
            await fs.promises.rename(temp, filePath);
        }).catch((error) => console.error("Failed to save EduAI data file:", error.message));
        return writing;
    }

    const publicMaterial = ({ content, userId, ...rest }) => rest;
    const ownedBy = (userId) => (item) => item.userId === userId;

    function conversationSummary(conversation) {
        const messages = data.messages.filter((message) => message.conversationId === conversation.id);
        const last = messages[messages.length - 1];
        const { userId, ...rest } = conversation;
        return { ...copy(rest), messageCount: messages.length, preview: last ? last.content.slice(0, 160) : null };
    }

    function touchConversation(conversationId) {
        const conversation = data.conversations.find((item) => item.id === conversationId);
        if (conversation) conversation.updatedAt = now();
    }

    return {
        kind: "file",

        async init() {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            try {
                const saved = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
                for (const name of COLLECTIONS) data[name] = Array.isArray(saved[name]) ? saved[name] : [];
            } catch (error) {
                if (error.code !== "ENOENT") {
                    throw new Error(`Could not read EduAI data file at ${filePath}: ${error.message}`);
                }
            }
            console.log(`Using file storage at ${filePath}`);
        },

        async close() {
            await flush();
        },

        flush,

        /* Users */
        async findUserByEmail(email) {
            return copy(data.users.find((user) => user.email === email)) || null;
        },

        async getUserById(id) {
            return copy(data.users.find((user) => user.id === id)) || null;
        },

        async createUser({ name, email, passwordHash }) {
            const user = { id: newId(), name, email, role: "student", passwordHash, createdAt: now() };
            data.users.push(user);
            persistSoon();
            return copy(user);
        },

        /* Conversations */
        async listConversations(userId) {
            return data.conversations
                .filter(ownedBy(userId))
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map(conversationSummary);
        },

        async getConversation(userId, id) {
            const conversation = data.conversations.find((item) => item.id === id && item.userId === userId);
            if (!conversation) return null;
            const { userId: _owner, ...rest } = conversation;
            const messages = data.messages
                .filter((message) => message.conversationId === id)
                .map(({ conversationId, ...message }) => message);
            return copy({ ...rest, messages });
        },

        async createConversation(userId, { title, settings }) {
            const conversation = { id: newId(), userId, title, settings: settings || {}, createdAt: now(), updatedAt: now() };
            data.conversations.push(conversation);
            persistSoon();
            const { userId: _owner, ...rest } = conversation;
            return copy({ ...rest, messages: [] });
        },

        async updateConversation(userId, id, { title, settings }) {
            const conversation = data.conversations.find((item) => item.id === id && item.userId === userId);
            if (!conversation) return null;
            if (title !== undefined && title !== null) conversation.title = title;
            if (settings !== undefined && settings !== null) conversation.settings = settings;
            conversation.updatedAt = now();
            persistSoon();
            return conversationSummary(conversation);
        },

        async deleteConversation(userId, id) {
            const index = data.conversations.findIndex((item) => item.id === id && item.userId === userId);
            if (index === -1) return false;
            data.conversations.splice(index, 1);
            data.messages = data.messages.filter((message) => message.conversationId !== id);
            for (const note of data.notes) {
                if (note.sourceConversationId === id) note.sourceConversationId = null;
            }
            persistSoon();
            return true;
        },

        async addMessage(conversationId, { role, content, meta = {}, createdAt }) {
            const message = { id: newId(), conversationId, role, content, meta, createdAt: createdAt || now() };
            data.messages.push(message);
            touchConversation(conversationId);
            persistSoon();
            const { conversationId: _conversation, ...rest } = message;
            return copy(rest);
        },

        async deleteMessage(conversationId, messageId) {
            const index = data.messages.findIndex((message) => message.id === messageId && message.conversationId === conversationId);
            if (index === -1) return false;
            data.messages.splice(index, 1);
            persistSoon();
            return true;
        },

        async importConversation(userId, { title, settings, createdAt, updatedAt, messages }) {
            const conversation = { id: newId(), userId, title, settings: settings || {}, createdAt, updatedAt };
            data.conversations.push(conversation);
            for (const message of messages) {
                data.messages.push({ id: newId(), conversationId: conversation.id, role: message.role, content: message.content, meta: message.meta || {}, createdAt: message.createdAt });
            }
            persistSoon();
            return conversationSummary(conversation);
        },

        /* Materials */
        async listMaterials(userId) {
            return data.materials.filter(ownedBy(userId)).sort((a, b) => b.createdAt - a.createdAt).map((item) => copy(publicMaterial(item)));
        },

        async getMaterials(userId, ids) {
            return data.materials
                .filter((item) => item.userId === userId && ids.includes(item.id))
                .map(({ userId: _owner, ...rest }) => copy(rest));
        },

        async createMaterial(userId, { name, mimeType, sizeBytes, content, truncated }) {
            const material = { id: newId(), userId, name, mimeType, sizeBytes, content, charCount: content.length, truncated, createdAt: now() };
            data.materials.push(material);
            persistSoon();
            return copy(publicMaterial(material));
        },

        async deleteMaterial(userId, id) {
            const index = data.materials.findIndex((item) => item.id === id && item.userId === userId);
            if (index === -1) return false;
            data.materials.splice(index, 1);
            persistSoon();
            return true;
        },

        /* Notes */
        async listNotes(userId) {
            return data.notes.filter(ownedBy(userId)).sort((a, b) => b.updatedAt - a.updatedAt).map(({ userId: _owner, ...rest }) => copy(rest));
        },

        async getNote(userId, id) {
            const note = data.notes.find((item) => item.id === id && item.userId === userId);
            if (!note) return null;
            const { userId: _owner, ...rest } = note;
            return copy(rest);
        },

        async createNote(userId, { title, content, kind, sourceConversationId }) {
            const note = { id: newId(), userId, title, content, kind, sourceConversationId: sourceConversationId || null, createdAt: now(), updatedAt: now() };
            data.notes.push(note);
            persistSoon();
            const { userId: _owner, ...rest } = note;
            return copy(rest);
        },

        async updateNote(userId, id, { title, content }) {
            const note = data.notes.find((item) => item.id === id && item.userId === userId);
            if (!note) return null;
            if (title !== undefined && title !== null) note.title = title;
            if (content !== undefined && content !== null) note.content = content;
            note.updatedAt = now();
            persistSoon();
            const { userId: _owner, ...rest } = note;
            return copy(rest);
        },

        async deleteNote(userId, id) {
            const index = data.notes.findIndex((item) => item.id === id && item.userId === userId);
            if (index === -1) return false;
            data.notes.splice(index, 1);
            persistSoon();
            return true;
        },

        /* Quizzes */
        async listQuizzes(userId) {
            return data.quizzes.filter(ownedBy(userId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).map(({ userId: _owner, ...rest }) => copy(rest));
        },

        async getQuiz(userId, id) {
            const quiz = data.quizzes.find((item) => item.id === id && item.userId === userId);
            if (!quiz) return null;
            const { userId: _owner, ...rest } = quiz;
            return copy(rest);
        },

        async createQuiz(userId, { topic, title, level, sourceLabel, questions }) {
            const quiz = {
                id: newId(), userId, topic, title, level, sourceLabel, questions,
                responses: null, results: null, score: null, total: questions.length,
                status: "in_progress", createdAt: now(), completedAt: null,
            };
            data.quizzes.push(quiz);
            persistSoon();
            const { userId: _owner, ...rest } = quiz;
            return copy(rest);
        },

        async completeQuiz(userId, id, { responses, results, score }) {
            const quiz = data.quizzes.find((item) => item.id === id && item.userId === userId);
            if (!quiz) return null;
            Object.assign(quiz, { responses, results, score, status: "completed", completedAt: now() });
            persistSoon();
            const { userId: _owner, ...rest } = quiz;
            return copy(rest);
        },

        async deleteQuiz(userId, id) {
            const index = data.quizzes.findIndex((item) => item.id === id && item.userId === userId);
            if (index === -1) return false;
            data.quizzes.splice(index, 1);
            persistSoon();
            return true;
        },

        /* Study sessions */
        async listStudySessions(userId) {
            return data.studySessions.filter(ownedBy(userId)).sort((a, b) => b.createdAt - a.createdAt).map(({ userId: _owner, ...rest }) => copy(rest));
        },

        async createStudySession(userId, { topic, notes, status }) {
            const session = { id: newId(), userId, topic, notes, status, createdAt: now(), updatedAt: now() };
            data.studySessions.push(session);
            persistSoon();
            const { userId: _owner, ...rest } = session;
            return copy(rest);
        },

        /* Progress */
        async getStats(userId) {
            const conversationIds = new Set(data.conversations.filter(ownedBy(userId)).map((item) => item.id));
            return {
                conversations: conversationIds.size,
                questionsAsked: data.messages.filter((message) => message.role === "user" && conversationIds.has(message.conversationId)).length,
                notes: data.notes.filter(ownedBy(userId)).length,
                materials: data.materials.filter(ownedBy(userId)).length,
            };
        },
    };
}

module.exports = { createFileStore };
