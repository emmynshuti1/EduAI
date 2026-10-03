const users = new Map();
const conversationsByUser = new Map();

function makeId(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function toPublicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "student",
        created_at: user.created_at || new Date().toISOString(),
    };
}

function findMemoryUserByEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    for (const user of users.values()) {
        if (String(user.email).trim().toLowerCase() === normalized) {
            return user;
        }
    }
    return null;
}

function getMemoryUserById(id) {
    return users.get(id) || null;
}

function createMemoryUser({ name, email, passwordHash }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = {
        id: makeId("user"),
        name: String(name || "User").trim() || "User",
        email: normalizedEmail,
        password_hash: passwordHash,
        role: "student",
        created_at: new Date().toISOString(),
    };
    users.set(user.id, user);
    conversationsByUser.set(user.id, conversationsByUser.get(user.id) || []);
    return user;
}

function listConversationsForUser(userId) {
    return (conversationsByUser.get(userId) || []).map((conversation) => ({
        ...conversation,
        messages: conversation.messages || [],
    }));
}

function createMemoryConversation(userId, title = "New chat") {
    const list = conversationsByUser.get(userId) || [];
    const conversation = {
        id: makeId("conv"),
        user_id: userId,
        title: title || "New chat",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: [],
    };
    list.unshift(conversation);
    conversationsByUser.set(userId, list);
    return conversation;
}

function getMemoryConversation(userId, conversationId) {
    const list = conversationsByUser.get(userId) || [];
    return list.find((item) => item.id === conversationId) || null;
}

function updateMemoryConversationTitle(userId, conversationId, title) {
    const conversation = getMemoryConversation(userId, conversationId);
    if (!conversation) return null;

    conversation.title = title;
    conversation.updated_at = new Date().toISOString();
    return conversation;
}

function addMemoryMessage(userId, conversationId, role, content) {
    const conversation = getMemoryConversation(userId, conversationId);
    if (!conversation) return null;

    const message = {
        id: makeId("msg"),
        role,
        content,
        created_at: new Date().toISOString(),
    };
    conversation.messages.push(message);
    conversation.updated_at = new Date().toISOString();
    return message;
}

function deleteMemoryConversation(userId, conversationId) {
    const list = conversationsByUser.get(userId) || [];
    const index = list.findIndex((item) => item.id === conversationId);
    if (index === -1) return false;
    list.splice(index, 1);
    conversationsByUser.set(userId, list);
    return true;
}

module.exports = {
    users,
    conversationsByUser,
    makeId,
    toPublicUser,
    findMemoryUserByEmail,
    getMemoryUserById,
    createMemoryUser,
    listConversationsForUser,
    createMemoryConversation,
    getMemoryConversation,
    updateMemoryConversationTitle,
    addMemoryMessage,
    deleteMemoryConversation,
};
