const fs = require("fs").promises;
const path = require("path");

const dbPath = path.join(__dirname, "database.json");

// Reads the entire database from the JSON file.
async function readDb() {
  try {
    const data = await fs.readFile(dbPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    // If the file doesn't exist, return an empty object.
    if (error.code === "ENOENT") {
      return {};
    }
    console.error("Error reading database:", error);
    throw error;
  }
}

// Writes the entire database object to the JSON file.
async function writeDb(data) {
  try {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error writing to database:", error);
    throw error;
  }
}

// Saves a user's tokens to the database.
async function saveToken(athleteId, tokens) {
  const db = await readDb();
  db[athleteId] = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
  };
  await writeDb(db);
}

// Retrieves a user's tokens from the database.
async function getToken(athleteId) {
  const db = await readDb();
  return db[athleteId];
}

module.exports = { saveToken, getToken, readDb };
