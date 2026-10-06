<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/2c86f8e7-e45d-4aad-a608-16eb18959dd5

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Supabase Configuration

### Password Reset Redirect URLs

For the password reset flow to work correctly, you must configure the redirect URLs in your Supabase project dashboard:

1. Go to your Supabase project → **Authentication** → **URL Configuration**
2. Add the following URLs to **Redirect URLs**:
   - `http://localhost:5173/reset-password` (local development)
   - `https://your-production-domain.com/reset-password` (production)
   - `https://*.vercel.app/reset-password` (Vercel preview deployments - use wildcard pattern)

**Example for Vercel deployments:**
- Production: `https://your-app.vercel.app/reset-password`
- Preview: `https://*-your-username.vercel.app/reset-password`

The password reset email will contain a link that redirects users back to your app with a recovery token. Without the correct redirect URLs configured, the reset link will fail.
