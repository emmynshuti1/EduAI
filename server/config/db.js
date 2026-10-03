const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const pool = new Pool({
    connectionString,
    max: 10,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL client error:", error);
});

async function query(text, params = []) {
    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured.");
    }

    return pool.query(text, params);
}

module.exports = {
    pool,
    query,
};
