# Strava to Discord Bot

A simple Node.js application that posts new Strava activities from authorized users to a designated Discord channel in real-time.

## How It Works

This application uses the Strava API, Discord Webhooks, and a PostgreSQL database to function:

1.  **Authentication**: Users visit the application's homepage and authorize it with their Strava account via OAuth2. Their secure tokens are stored in the PostgreSQL database. The system handles re-authentication gracefully by updating existing records.
2.  **Persistent Storage**: A PostgreSQL database is used to securely store user tokens, ensuring data persists across server restarts and deployments.
3.  **Webhook Subscription**: On startup, the server automatically checks for an active webhook subscription with Strava. If one doesn't exist for its callback URL, it creates one. This ensures the connection is always active when the server is running.
4.  **Activity Posting**: When any authorized user creates a new activity, Strava sends a notification to the server's webhook. The server then fetches the activity details and posts a condensed, formatted message to the configured Discord channel.

## Required Environment Variables

To run this application, you must define the following environment variables in your deployment environment (e.g., Coolify).

| Variable                | Description                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `STRAVA_CLIENT_ID`      | Your Strava application's Client ID.                                                                    |
| `STRAVA_CLIENT_SECRET`  | Your Strava application's Client Secret.                                                                |
| `DISCORD_WEBHOOK_URL`   | The webhook URL for the Discord channel where activities will be posted.                                |
| `APP_URL`               | The public-facing URL of your application (e.g., `https://stravabot.zcamp.lol`).                            |
| `STRAVA_VERIFY_TOKEN`   | A unique, secret string you create to validate webhook requests from Strava.                              |
| `DATABASE_URL`          | The full connection string for your PostgreSQL 16 database (e.g., `postgres://user:pass@host:port/db`). |