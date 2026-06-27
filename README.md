# 🚜 ShedLog — Maintenance Tracker

A simple, offline-capable app for tracking maintenance on your **tractors, implements, tools, and vehicles**. Log completed service, set up recurring schedules (by engine hours, mileage, or time), and see at a glance what's due or overdue.

It's a **Progressive Web App (PWA)** — it installs to your iPhone home screen straight from Safari, runs full-screen with its own icon, and works **offline** with all data stored privately on your device. No App Store, no account, no Mac required.

---

## 📲 How to install it on your iPhone

Once the app is published to a web address (see **Publishing** below), installing takes about 15 seconds:

1. Open the app's link in **Safari** on your iPhone (it must be Safari, not Chrome).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top-right corner.

You'll now have a **ShedLog** icon on your home screen. Open it and it runs like a normal app — full screen, offline, and your data stays on your phone.

> **Where's my data?** Everything is saved locally on your device. Nothing is uploaded anywhere. (Because of that, deleting the app or clearing Safari's data will erase your records — so use the built-in backup below to keep a copy.)

### 💾 Backing up to the Files app / iCloud Drive

On the **Dashboard** there's a **Data & Backup** section:

- **Export / Save to Files** — creates a backup file (`shedlog-backup-YYYY-MM-DD.json`). On iPhone, the share sheet pops up and you tap **Save to Files** to store it in iCloud Drive or "On My iPhone". You can also AirDrop or email it from there.
- **Restore from Backup** — pick a backup file (from the Files app) to load all your equipment, schedules, and history back. This also lets you move your data to a new phone.

The Export row also shows when you last backed up (e.g. *"Last backed up 3 days ago"*), and the dashboard shows a **"Time to back up"** reminder if you've never backed up or it's been more than two weeks. Tap **Back Up Now** to save, or **Later** to snooze it for a week.

---

## 🚀 Publishing it (one-time setup)

This repo is ready to host for free on **GitHub Pages**. A workflow is already included (`.github/workflows/deploy-pages.yml`).

1. Push this code to GitHub (the branch is already set up).
2. In your repo on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. The included workflow runs automatically on each push and publishes the site. When it finishes, **Settings → Pages** shows your live URL, typically:

   ```
   https://<your-username>.github.io/tractor-maintenance-app/
   ```

5. Open that URL on your iPhone and follow the install steps above.

> If you want it to publish from the `main` branch, merge this branch into `main` — the workflow already triggers on both `main` and the development branch.

### Prefer not to use GitHub Pages?

Any static web host works (Netlify, Vercel, Cloudflare Pages, or even a folder on your own server) — just upload all the files in this repo. There's no build step.

---

## ✨ What it does

- **Four equipment types** — tractors 🚜, implements 🔧, tools 🛠️, and vehicles 🚛, each on its own usage meter (engine hours, miles, or none).
- **Service schedules** — recurring maintenance defined by usage (e.g. *oil every 100 hours*) **or** time (e.g. *grease every 90 days*). The dashboard shows what's **due soon** or **overdue**.
- **Maintenance log** — record what was done, the date, the hour/mile reading, cost, and notes. Logging service against a schedule resets its countdown automatically.
- **Dashboard** — a single screen showing everything that needs attention, ranked by urgency.
- **History** — a full, searchable-by-month service record across all your equipment, with total spend.
- **Works offline** — installed as a PWA, it opens and runs with no internet connection.

---

## 🛠️ Tech notes

- Plain HTML, CSS, and vanilla JavaScript — no frameworks, no dependencies, no build step.
- Data persistence via the browser's `localStorage`.
- Offline support via a service worker (`sw.js`) caching the app shell.
- Designed mobile-first with iOS safe-area insets, light/dark mode, and a native-feeling tab bar.

### File layout

| File | Purpose |
|------|---------|
| `index.html` | App shell and layout |
| `styles.css` | All styling (light + dark) |
| `app.js` | App logic, data store, views, and forms |
| `manifest.webmanifest` | PWA metadata (name, icons, colors) |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons |
| `.github/workflows/deploy-pages.yml` | Auto-deploy to GitHub Pages |

---

## 🧪 Running it locally

Because of the service worker, open it through a local web server (not by double-clicking the file):

```bash
# from the project folder
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in your browser.
