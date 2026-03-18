# Capacitor Setup Guide — Remedi
## One-time setup to enable native iOS + Android builds

---

## What This Does

Capacitor wraps the existing React web app inside a native iOS/Android shell.
The web code stays the same. Capacitor adds:
- **Real push notifications** (work when app is closed, screen is off)
- **Haptic feedback** (vibration on alarms)
- **App Store / Google Play submission**
- **Full device access** (camera, contacts, etc. — for future features)

---

## Prerequisites

- Node.js 18+ installed
- Git
- For Android: Android Studio installed
- For iOS: macOS + Xcode (OR use Ionic Appflow cloud build — no Mac needed)

---

## Step 1 — Install dependencies

```bash
cd ChronaCare
npm install
```

This installs `@capacitor/core`, `@capacitor/cli`, `@capacitor/local-notifications`, etc.

---

## Step 2 — Build the web app

```bash
npm run build
```

This creates the `dist/` folder that Capacitor wraps.

---

## Step 3 — Add Android platform

```bash
npx cap add android
```

This creates the `android/` directory with a full Android Studio project.

---

## Step 4 — Add iOS platform (Mac only / or skip for cloud build)

```bash
npx cap add ios
```

This creates the `ios/` directory with a full Xcode project.
**Skip this if you don't have a Mac — use Ionic Appflow instead (see below).**

---

## Step 5 — Sync web build into native projects

Run this every time you make web changes:

```bash
npm run cap:sync
```

Or manually:
```bash
npm run build && npx cap sync
```

---

## Step 6 — Open in Android Studio

```bash
npm run cap:android
```

In Android Studio:
1. Wait for Gradle sync to finish
2. Click ▶ Run (or Shift+F10)
3. Select your device or emulator
4. App will build and launch

---

## Step 7 — Open in Xcode (Mac only)

```bash
npm run cap:ios
```

In Xcode:
1. Select your signing team (Apple Developer account required)
2. Select your device
3. Click ▶ Run

---

## iOS Without a Mac — Ionic Appflow

Since James doesn't have a Mac, use Ionic Appflow for iOS builds:

1. Go to https://ionic.io/appflow
2. Create a free account
3. Connect your GitHub repo (hendersonjames/AiPillReminder)
4. Create a new build → iOS → Debug
5. Download the `.ipa` file
6. Install on device via TestFlight or direct install

**Appflow free tier:** 1 concurrent build, works for our needs.

---

## Android Build via GitHub Actions (Automated)

The workflow at `.github/workflows/build-android.yml` automatically builds an APK
on every push to `main`.

**Setup required:**
1. Go to GitHub → Settings → Secrets → Actions
2. Add these secrets:
   - `VITE_SUPABASE_URL` → your Supabase URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` → your Supabase anon key (JWT format)
   - `GEMINI_API_KEY` → your Gemini API key
3. Push any change to `main`
4. Go to Actions tab → download the APK from Artifacts

---

## Required for App Store Submission

### Android (Google Play)
- [ ] Create Google Play Console account ($25 one-time)
- [ ] Build a release APK (signed): `./gradlew assembleRelease`
- [ ] Create keystore for signing (do this once, save it safely)
- [ ] Upload to Play Console → create internal testing track first

### iOS (App Store)
- [ ] Apple Developer account ($99/year)
- [ ] Bundle ID registered: `com.remediapp.app`
- [ ] App Store Connect listing created
- [ ] Build via Xcode or Ionic Appflow
- [ ] TestFlight for beta testing before submission

---

## Notification Permissions — What Users See

**Android:** On first launch, app automatically requests notification permission (Android 13+).

**iOS:** On first login, app calls `LocalNotifications.requestPermissions()`.
User sees: "Remedi would like to send you notifications" → Allow.

---

## Updating the App

Workflow for any code change:

```bash
# 1. Make your changes
# 2. Build
npm run build

# 3. Sync to native
npx cap sync

# 4. Open in IDE
npx cap open android   # or ios
```

---

## Troubleshooting

**"vite not found"** → Run `npm install` first

**"Capacitor not initialized"** → Run `npx cap add android` (step 3)

**Notifications not showing on Android** → Check that the app has notification permission in Settings → Apps → Remedi → Notifications

**App crashes on launch** → Check Android Studio Logcat for errors

---

*Setup guide by Max — March 2026*
