/*
================================================================================
| --- File: index.js ---                                                     |
| Description: Main application logic with Express server.                   |
================================================================================
*/
const express = require("express");
const axios = require("axios");
const path = require("path");
const { saveToken, getToken } = require("./db");

// --- Environment Variable Validation ---
const requiredEnvVars = [
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "DISCORD_WEBHOOK_URL",
  "APP_URL",
  "STRAVA_VERIFY_TOKEN",
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
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

// --- Strava API Configuration ---
const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_ACTIVITY_URL = "https://www.strava.com/api/v3/activities/";

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
    await saveToken(athlete.id, { access_token, refresh_token, expires_at });

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

  // Acknowledge the event immediately
  res.status(200).send("EVENT_RECEIVED");

  // Process the event
  if (
    req.body.object_type === "activity" &&
    req.body.aspect_type === "create"
  ) {
    const athleteId = req.body.owner_id;
    const activityId = req.body.object_id;

    try {
      const user = await getToken(athleteId);
      if (!user) throw new Error(`No token found for athlete ${athleteId}`);

      const activityResponse = await axios.get(
        `${STRAVA_ACTIVITY_URL}${activityId}`,
        {
          headers: { Authorization: `Bearer ${user.accessToken}` },
        }
      );

      await postActivityToDiscord(activityResponse.data);
    } catch (error) {
      console.error("Failed to process webhook event:", error.message);
    }
  }
});

// --- Helper Functions ---

async function postActivityToDiscord(activity) {
  // Convert data for better display
  const distanceKm = (activity.distance / 1000).toFixed(2);
  const movingTime = new Date(activity.moving_time * 1000)
    .toISOString()
    .substr(11, 8);
  const elevation = Math.round(activity.total_elevation_gain);

  const athleteName = activity.athlete.firstname
    ? `${activity.athlete.firstname} ${activity.athlete.lastname}`
    : "An athlete";

  const embed = {
    username: "Strava Bot",
    avatar_url: "https://i.imgur.com/bM2nKk7.png", // A generic orange running icon
    embeds: [
      {
        author: {
          name: `${athleteName} just completed an activity!`,
          url: `https://www.strava.com/athletes/${activity.athlete.id}`,
        },
        title: activity.name,
        url: `https://www.strava.com/activities/${activity.id}`,
        color: 16737536, // Strava Orange
        fields: [
          { name: "Type", value: activity.sport_type, inline: true },
          { name: "Distance", value: `${distanceKm} km`, inline: true },
          { name: "Moving Time", value: movingTime, inline: true },
          { name: "Elevation", value: `${elevation} m`, inline: true },
        ],
        timestamp: activity.start_date,
      },
    ],
  };

  try {
    await axios.post(DISCORD_WEBHOOK_URL, embed);
    console.log(`Successfully posted activity ${activity.id} to Discord.`);
  } catch (error) {
    console.error(
      "Error posting to Discord:",
      error.response ? error.response.data : error.message
    );
  }
}

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`App URL: ${APP_URL}`);
  console.log(
    `Ensure your Strava Webhook subscription callback is set to: ${APP_URL}/webhook`
  );
});
