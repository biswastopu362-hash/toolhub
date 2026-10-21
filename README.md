# ToolHub — All-in-One PWA App Hub

A Progressive Web App that works like a phone OS: a home screen with draggable icons and folders, and a full **App Store** where users install exactly the apps they need. Calculators, converters, gallery, camera, video editing, audio recording, music, paint, calendar, AI assistant, games and more — installable, offline-capable and beautifully themeable on every device.

## Features

- **App Store with install / uninstall** — apps are stored in the store; users install what they need with a progress animation, uninstall anytime (long-press → ✕ or from the store), and system apps stay protected
- **Native phone-OS feel** — home-screen pages, dock, App Library, spotlight search, and iPad-style zoom open/minimize animations for every app window
- **Drag & drop + folders** — long-press any icon to enter edit mode: drag to rearrange, drop one app on another to create a folder, merge folders, hold near a screen edge to flip pages
- **Deep theming** — Light / Dark / AMOLED / System modes × 8 accent palettes × 12 animated wallpapers, switchable from the control center or Settings
- **28 apps across 9 categories** — media (Gallery, Camera, Video Studio, Music, Paint), productivity (Notes, Calendar, Reminders, Clock), utilities (AI Assistant with server-side LLM, Weather, converters, generators) and games (2048)
- **Offline-first PWA** — installable on Android, iOS and desktop; service worker caches the app shell
- **Everything on-device** — photos, recordings, notes, events and layout persist in localStorage / IndexedDB (no account, no server)

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS 4 + shadcn/ui + framer-motion
- Zustand (persisted client state)
- IndexedDB for media (photos, audio), localStorage for settings
- One API route (`/api/ai`) powering the AI Assistant via `z-ai-web-dev-sdk`
- Single route (`/`) with hash-based navigation (`#/app/<id>`)

## Run locally

```bash
bun install
bun run dev        # http://localhost:3000
bun run lint       # ESLint
```

## Deploy to Vercel

1. Push this repository to GitHub:

   ```bash
   git init
   git add .
   git commit -m "ToolHub v3.0 — App Store OS"
   git branch -M main
   git remote add origin https://github.com/<you>/toolhub.git
   git push -u origin main
   ```

2. Go to [vercel.com/new](https://vercel.com/new), import the GitHub repo — Next.js is auto-detected, no config needed.
3. Deploy. That's it — no environment variables are required (the AI route uses the built-in SDK credentials).

## Database: do you need one?

**Not today.** Every feature (photos, audio, notes, events, installed apps, home layout, themes) is stored on-device via localStorage/IndexedDB, which keeps the app instant, private, offline-capable and free to host. Note that Vercel's serverless filesystem is ephemeral, so the bundled SQLite setup would not persist there anyway.

**When you'll want one:** cross-device sync, user accounts, shared/community content or server-side analytics. At that point add Vercel Postgres (Neon) or Turso with Prisma — the `prisma/schema.prisma` placeholder and `postinstall: prisma generate` hook are already wired for a zero-friction upgrade, and the store state (`installed`, `layout`) is a single user-scoped table away.

## Adding a new app (incremental development)

1. Create `src/components/tools/<tool-id>.tsx` — a `'use client'` component with a default export. It renders inside the app window (`max-w-4xl`, scrollable body).
2. Register it in `src/lib/tools/registry.tsx`: id, name, description, category, icon, gradient, glow, keywords and a lazy `Component` — plus optional store metadata (`tagline`, `version`, `featured`, `system`).
3. Done — it automatically appears in the App Store (with GET/progress/Open buttons, detail page, categories, top charts and search), Spotlight, App Library and Settings. New installs drop onto the home screen; uninstalls clean up folders automatically.
