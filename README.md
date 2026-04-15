# GrabTrack Bot 🟢

Telegram bot for Jerome to track Grab Driver earnings via monthly PDF statements.

## How to Deploy on Railway (Free)

### Step 1 — Upload to GitHub
1. Go to https://github.com and create a free account if you don't have one
2. Click **New repository** → name it `grabtrack-bot` → Create
3. Upload all 3 files: `index.js`, `package.json`, `railway.toml`

### Step 2 — Deploy on Railway
1. Go to https://railway.app and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select `grabtrack-bot`
4. Railway will auto-detect and deploy it ✅

### Step 3 — Done!
Your bot is now running 24/7 for free.

---

## How to Use the Bot

| Action | What to do |
|--------|-----------|
| Log earnings | Send your Grab monthly statement PDF |
| View all-time totals | Type `/summary` |
| View month-by-month | Type `/monthly` |
| Clear data | Type `/clear` |

## Bot Commands
- `/start` — Welcome message
- `/summary` — All-time earnings summary
- `/monthly` — Month-by-month breakdown
- `/clear` — Clear all stored data
- `/help` — Show help

---
Bot Token & Chat ID are pre-configured in the code.
