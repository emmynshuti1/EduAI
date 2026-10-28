const path = require("path");

/*
 * Chooses the persistence backend once at startup:
 * - PostgreSQL when DATABASE_URL (or POSTGRES_URL) is set
 * - otherwise a JSON file under server/data (or EDUAI_DATA_FILE)
 */
let store = null;

function createStore() {
    if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
        const { createPgStore } = require("./pgStore");
        return createPgStore();
    }

    const { createFileStore } = require("./fileStore");
    const filePath = process.env.EDUAI_DATA_FILE || path.join(__dirname, "..", "data", "eduai-data.json");
    return createFileStore({ filePath });
}

function getStore() {
    if (!store) store = createStore();
    return store;
}

module.exports = { getStore };
