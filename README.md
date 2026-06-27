# 🚜 Tractor Shed — Maintenance Tracker

A simple, offline-capable app for tracking maintenance on your **tractors, implements, tools, and vehicles**. Log completed service, set up recurring schedules (by engine hours, mileage, or time), and see at a glance what's due or overdue.

It's a **Progressive Web App (PWA)** — it installs to your iPhone home screen straight from Safari, runs full-screen with its own icon, and works **offline** with all data stored privately on your device. No App Store, no account, no Mac required.

---

## 📲 How to install it on your iPhone

Once the app is published to a web address (see **Publishing** below), installing takes about 15 seconds:

1. Open the app's link in **Safari** on your iPhone (it must be Safari, not Chrome).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top-right corner.

You'll now have a **Tractor Shed** icon on your home screen. Open it and it runs like a normal app — full screen, offline, and your data stays on your phone.

> **Where's my data?** Everything is saved locally on your device. Nothing is uploaded anywhere. (Because of that, deleting the app or clearing Safari's data will erase your records — so use the built-in backup below to keep a copy.)

### 💾 Backing up to the Files app / iCloud Drive

On the **Dashboard** there's a **Data & Backup** section:

- **Export / Save to Files** — creates a backup file (`tractor-shed-backup-YYYY-MM-DD.json`), including your photos and stored manuals. On iPhone, the share sheet pops up and you tap **Save to Files** to store it in iCloud Drive or "On My iPhone". You can also AirDrop or email it from there.
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
- **Consumables & parts reference** — per machine, keep a list of the oils, greases, fluids, filters, belts, tires, batteries, plugs, blades, and other parts it needs, with the spec/grade, part number, and quantity/capacity. So when it's time to service, you know exactly what to buy.
- **Stock tracking** — give any part an *on-hand* count and a *reorder-at* level. Parts at or below their threshold (or at zero) are flagged.
- **Parts used when logging** — logging maintenance lets you tick off which saved parts you used; those quantities are automatically deducted from on-hand stock and recorded on the entry.
- **Shopping List** — a dedicated tab that gathers what to buy: anything low/out of stock, plus the parts linked to any machine with service due. Shows an estimated total from part costs, a one-tap **Restock** button, and Share/Copy to take to the store. A red dot on the tab warns when something's low.
- **Parts linked to schedules** — attach specific parts to a service schedule. When you log that service, the schedule prefills the entry and its parts are pre-checked; the Shopping List then lists exactly those parts when it's due.
- **Log against a schedule** — when logging maintenance, pick one of the machine's schedules to prefill the work, auto-select its parts, and reset its countdown in one step.
- **Part costs** — give a part a unit cost to see estimated shopping totals.
- **Instructions per task** — write step-by-step how-to notes (torque specs, fill amounts, tips) on any service schedule; they show when you view the schedule and when you log it.
- **Photos & locations** — snap reference photos for **equipment, individual schedules, or individual parts** (e.g. where each zerk fitting is) with a location note. A part's photo appears as a thumbnail in the parts lists. Saved on-device in IndexedDB and included in backups.
- **Manuals & documents** — store operator/parts manuals (PDF or image) per machine; tap to open, rename, or delete. Included in backups. The equipment page shows photo and document counts.
- **All Parts list** — one editable list of every part across all your equipment, reachable from the Equipment tab.
- **Search** — the Equipment tab has a search box that finds matches across equipment, parts (incl. part numbers), schedules, documents, and photo captions, grouped and tappable.
- **Reminders** — opt-in maintenance reminders badge the home-screen icon with items needing attention and send a once-a-day notification when you open the app. Each schedule can set a **lead time** ("remind me 1 week / 20 hours before due"). (Background push needs an internet account/server, so reminders refresh on open.)
- **Service templates** — apply a starter set of schedules for a machine's category (tractor/implement/vehicle/tool) in one tap, then tweak.
- **Barcode / QR scanning** — scan a VIN/serial when adding equipment, a part barcode when adding a part, or use the dashboard **Scan** button to jump straight to a machine or part. (Uses the device camera via a bundled scanner.)
- **Printable service report** — a clean per-machine report (details, schedules, parts, full history + total spend, and a QR that reopens the machine). Use the print dialog to **Save to PDF** or AirPrint.
- **Quick actions & home-screen shortcuts** — Log / Add / Scan buttons and a fleet stat strip on the dashboard; long-pressing the app icon offers quick "Log Maintenance" / "Add Equipment" shortcuts (where supported).
- **Maintenance log** — record what was done, the date, the hour/mile reading, cost, and notes. Logging service against a schedule resets its countdown automatically.
- **Dashboard** — a single screen showing everything that needs attention, ranked by urgency.
- **History** — a full, searchable-by-month service record across all your equipment, with total spend.
- **Polished UI** — icon tab bar, equipment photos as avatars, category color accents, swipe a schedule to mark it done or delete, pull-to-refresh, screen transitions, a Settings screen, and a 6-month spend chart on History.
- **Works offline** — installed as a PWA, it opens and runs with no internet connection.

---

## 🛠️ Tech notes

- Plain HTML, CSS, and vanilla JavaScript — no frameworks, no dependencies, no build step.
- Data persistence via the browser's `localStorage`; photos and manuals stored in `IndexedDB`.
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
| `vendor/zxing.min.js` | Bundled barcode/QR scanner + encoder (lazy-loaded) |
| `.github/workflows/deploy-pages.yml` | Auto-deploy to GitHub Pages |

---

## 🧪 Running it locally

Because of the service worker, open it through a local web server (not by double-clicking the file):

```bash
# from the project folder
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in your browser.
