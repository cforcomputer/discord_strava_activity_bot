const express = require("express");
const axios = require("axios");
const path = require("path");
const { initializeDb, saveToken, getToken } = require("./db");

// --- Environment Variable Validation ---
const requiredEnvVars = [
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "DISCORD_WEBHOOK_URL",
  "APP_URL",
  "STRAVA_VERIFY_TOKEN",
  "DATABASE_URL",
];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}

const {
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  DISCORD_WEBHOOK_URL,
  APP_URL,
  STRAVA_VERIFY_TOKEN,
} = process.env;

const PORT = process.env.PORT || 3000;

// --- Express App Setup ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Strava API Configuration ---
const STRAVA_API_BASE_URL = "https://www.strava.com/api/v3";
const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

// --- Routes ---

// 1. Start Authorization Flow
app.get("/auth/strava", (req, res) => {
  const redirectUri = `${APP_URL}/auth/callback`;
  const scope = "activity:read";
  const authUrl = `${STRAVA_AUTH_URL}?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&approval_prompt=force`;
  res.redirect(authUrl);
});

// 2. Handle Strava's Redirect
app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`Authorization failed: ${error}`);
  }
  try {
    const response = await axios.post(STRAVA_TOKEN_URL, {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: "authorization_code",
    });
    const { access_token, refresh_token, expires_at, athlete } = response.data;
    await saveToken(athlete.id, athlete.firstname, {
      access_token,
      refresh_token,
      expires_at,
    });
    res.send(
      "<h1>Success!</h1><p>Your Strava account is connected. You can close this window.</p>"
    );
  } catch (err) {
    console.error(
      "Error exchanging token:",
      err.response ? err.response.data : err.message
    );
    res.status(500).send("Failed to authenticate with Strava.");
  }
});

// 3. Handle Strava Webhooks
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === STRAVA_VERIFY_TOKEN) {
    console.log("Webhook validated successfully!");
    res.json({ "hub.challenge": challenge });
  } else {
    console.error("Webhook validation failed.");
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  console.log("Received webhook event:", JSON.stringify(req.body, null, 2));
  res.status(200).send("EVENT_RECEIVED"); // Acknowledge immediately

  if (
    req.body.object_type === "activity" &&
    req.body.aspect_type === "create"
  ) {
    const athleteId = req.body.owner_id;
    try {
      const user = await getValidToken(athleteId);
      if (!user)
        throw new Error(`Could not get valid token for athlete ${athleteId}`);

      const activityResponse = await axios.get(
        `${STRAVA_API_BASE_URL}/activities/${req.body.object_id}`,
        {
          headers: { Authorization: `Bearer ${user.accessToken}` },
        }
      );

      await postActivityToDiscord(activityResponse.data, user);
    } catch (error) {
      console.error("Failed to process webhook event:", error.message);
    }
  }
});

// --- Helper Functions ---
async function postActivityToDiscord(activity, user) {
  const distanceKm = (activity.distance / 1000).toFixed(2);
  const movingTime = new Date(activity.moving_time * 1000)
    .toISOString()
    .substr(11, 8);
  const elevation = Math.round(activity.total_elevation_gain);
  const athleteName = user.firstName || "An athlete";
  const activityType = activity.sport_type.toLowerCase();

  const content = `[${athleteName}](https://www.strava.com/activities/${activity.id}) just went for a ${activityType} of ${distanceKm}km for ${movingTime}, climbing ${elevation}m.`;

  const payload = {
    username: "Strava Bot",
    content: content,
  };

  try {
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log(`Successfully posted activity ${activity.id} to Discord.`);
  } catch (error) {
    console.error(
      "Error posting to Discord:",
      error.response ? error.response.data : error.message
    );
  }
}

// NEW: Gets a user's token and refreshes it if it's expired
async function getValidToken(athleteId) {
  const user = await getToken(athleteId);
  if (!user) return null;

  // Check if the token is expired or will expire in the next 5 minutes
  if (Date.now() / 1000 > user.expiresAt - 300) {
    console.log(`Token for athlete ${athleteId} is expired. Refreshing...`);
    try {
      const response = await axios.post(STRAVA_TOKEN_URL, {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: user.refreshToken,
      });

      const { access_token, refresh_token, expires_at } = response.data;
      const newTokens = { access_token, refresh_token, expires_at };
      await saveToken(athleteId, user.firstName, newTokens); // Resave with new tokens

      console.log(`Token refreshed successfully for athlete ${athleteId}.`);
      return { ...user, accessToken: access_token, expiresAt: expires_at };
    } catch (error) {
      console.error(
        `Failed to refresh token for athlete ${athleteId}:`,
        error.response ? error.response.data : error.message
      );
      return null;
    }
  }

  return user; // Token is still valid
}

async function subscribeToStravaWebhooks() {
  const callbackUrl = `${APP_URL}/webhook`;
  const pushSubscriptionsUrl = `${STRAVA_API_BASE_URL}/push_subscriptions`;
  try {
    const getResponse = await axios.get(pushSubscriptionsUrl, {
      params: {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
      },
    });
    const existingSubscription = getResponse.data.find(
      (sub) => sub.callback_url === callbackUrl
    );
    if (existingSubscription) {
      console.log(
        "Webhook subscription is already active. ID:",
        existingSubscription.id
      );
    } else {
      console.log(
        "No active webhook subscription found. Creating a new one..."
      );
      const postResponse = await axios.post(
        pushSubscriptionsUrl,
        new URLSearchParams({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          callback_url: callbackUrl,
          verify_token: STRAVA_VERIFY_TOKEN,
        })
      );
      console.log(
        "Successfully created new webhook subscription. ID:",
        postResponse.data.id
      );
    }
  } catch (error) {
    console.error(
      "Error during webhook subscription process:",
      error.response ? error.response.data : error.message
    );
  }
}

// --- Server Start ---
async function startServer() {
  try {
    await initializeDb();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`App URL: ${APP_URL}`);
      subscribeToStravaWebhooks();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
