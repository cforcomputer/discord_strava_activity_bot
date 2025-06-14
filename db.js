const { Pool } = require("pg");

// The pool will use the DATABASE_URL environment variable automatically.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initializes the database by creating the users table if it doesn't exist.
async function initializeDb() {
  const client = await pool.connect();
  try {
    await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                athlete_id BIGINT PRIMARY KEY,
                first_name TEXT,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at BIGINT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
    // Add the first_name column if it doesn't exist for backward compatibility
    await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
        `);
    console.log('Database table "users" is ready.');
  } catch (error) {
    console.error("Error initializing database table:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Saves or updates a user's tokens and first name using an "upsert" operation.
async function saveToken(athleteId, athleteFirstName, tokens) {
  const query = `
        INSERT INTO users (athlete_id, first_name, access_token, refresh_token, expires_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (athlete_id)
        DO UPDATE SET
            first_name = EXCLUDED.first_name,
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW();
    `;
  const values = [
    athleteId,
    athleteFirstName,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expires_at,
  ];

  try {
    await pool.query(query, values);
  } catch (error) {
    console.error("Error saving token to database:", error);
    throw error;
  }
}

// Retrieves a user's data from the database.
async function getToken(athleteId) {
  const query =
    "SELECT first_name, access_token, refresh_token, expires_at FROM users WHERE athlete_id = $1";
  try {
    const result = await pool.query(query, [athleteId]);
    if (result.rows.length > 0) {
      // Map column names to the expected object keys
      return {
        firstName: result.rows[0].first_name,
        accessToken: result.rows[0].access_token,
        refreshToken: result.rows[0].refresh_token,
        expiresAt: result.rows[0].expires_at,
      };
    }
    return null; // Return null if no user is found
  } catch (error) {
    console.error("Error retrieving token from database:", error);
    throw error;
  }
}

module.exports = { initializeDb, saveToken, getToken };
