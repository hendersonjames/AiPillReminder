<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ChronaCare / Remedi - AI Pill Reminder

A medication reminder app with AI-powered features, built with React, TypeScript, Supabase, and Google Gemini.

**Live Demo:** https://ai-pill-reminder.vercel.app

## Features

- Add and manage medication reminders with customizable schedules
- AI-powered medication information and chat assistant
- Cloud sync across devices via Supabase
- Doctor-friendly adherence reports
- Native mobile support via Capacitor (iOS/Android)

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file with your environment variables (see [Environment Variables](#environment-variables) below)

3. Run the app:
   ```bash
   npm run dev
   ```

The app will be available at http://localhost:3000

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Your Supabase anon/public key |
| `GEMINI_API_KEY` | No | Google Gemini API key (enables AI features) |

**Note:** The app will load and function without `GEMINI_API_KEY`, but AI features (chat, medication suggestions) will show friendly "not configured" messages.

### Vercel Deployment

Set these environment variables in your Vercel project settings:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY`

### Supabase Setup

Run the SQL in `supabase-schema.sql` in your Supabase SQL Editor to create the required tables.

## Build for Production

```bash
npm run build
```

## Mobile App (Capacitor)

See [CAPACITOR-SETUP.md](CAPACITOR-SETUP.md) for instructions on building native iOS/Android apps.
