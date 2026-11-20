# Deployment Guide

## 1. Create a Turso database

1. Sign up at [turso.tech](https://turso.tech) — no credit card required.
2. Install the Turso CLI:
   ```bash
   curl -sSfL https://get.turso.tech/install.sh | bash
   ```
3. Log in:
   ```bash
   turso auth login
   ```
4. Create the database:
   ```bash
   turso db create tewahdo-betekabo-bot
   ```
5. Get the database URL (copy the `URL` value):
   ```bash
   turso db show tewahdo-betekabo-bot
   ```
6. Create an auth token (copy the output):
   ```bash
   turso db tokens create tewahdo-betekabo-bot
   ```

## 2. Deploy on Koyeb

1. Sign up at [koyeb.com](https://koyeb.com) — no credit card required.
2. Create a new app → choose **GitHub** → select `Betrem26/Tewahdo-Betekabo-Bot`.
3. Set the following environment variables as **secrets** in Koyeb:

   | Key                  | Value                                      |
   |----------------------|--------------------------------------------|
   | `BOT_TOKEN`          | Your Telegram bot token                    |
   | `TURSO_DATABASE_URL` | The URL from `turso db show` (step 1-5)   |
   | `TURSO_AUTH_TOKEN`   | The token from `turso db tokens create`   |
   | `OWNER_USERNAME`     | `Jph2126`                                  |
   | `OWNER_CHAT_ID`      | `5586249161`                               |

4. Deploy — Koyeb reads `koyeb.yaml` at the repo root and runs `node src/bot.js`.

## 3. Local development

1. Copy the example env file:
   ```bash
   cp .env.example .env
   ```
2. Fill in your `BOT_TOKEN` in `.env`.
3. Leave `TURSO_DATABASE_URL` **blank** (or omit it) to use a local SQLite file at `data/bot.db`.
4. Install dependencies and start:
   ```bash
   npm install
   npm start
   ```

## Notes

- Turso free plan includes 9 GB storage and 1-day point-in-time restore.
- If the 9 GB limit is reached, writes will fail; archive old questions and contact Turso support to expand.
- The `data/` directory is git-ignored. The bot creates it automatically on first run.
