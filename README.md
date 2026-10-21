# ToolHub — All-in-One PWA Toolbox

A Progressive Web App that works like a phone's home screen: an app-store-style hub where every tool lives as an "app" — calculator, converters, QR studio, notes, weather, developer tools and more. Installable, offline-capable, and beautifully themeable on every device.

## Features

- **Native phone-OS feel** — home-screen pages, dock, App Library, spotlight search, folder support
- **Long-press any icon** to enter edit mode: drag to rearrange, drop one app on another to create a folder, drag near a screen edge to flip pages
- **Deep theming** — Light / Dark / AMOLED / System modes × 8 accent palettes × 12 animated wallpapers
- **19 built-in apps** and a registry architecture that makes adding new ones trivial
- **Offline-first PWA** — installable on Android, iOS and desktop; service worker caches the app shell
- **Everything on-device** — notes, reminders, favorites and layout persist in localStorage (no account, no server)

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS 4 + shadcn/ui + framer-motion
- Zustand (persisted client state)
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
   git commit -m "ToolHub v1.0"
   git branch -M main
   git remote add origin https://github.com/<you>/toolhub.git
   git push -u origin main
   ```

2. Go to [vercel.com/new](https://vercel.com/new), import the GitHub repo — Next.js is auto-detected, no config needed.
3. Deploy. That's it — no environment variables are required for the current feature set.

## Database: do you need one?

**Not today.** Every feature (notes, reminders, favorites, theme, home layout) is stored on-device via localStorage, which keeps the app instant, private, offline-capable and free to host. Note that Vercel's serverless filesystem is ephemeral, so the bundled SQLite setup would not persist there anyway.

**When you'll want one:** cross-device sync, user accounts, shared/community content. At that point add Vercel Postgres (Neon) or Turso with Prisma — the `prisma/schema.prisma` placeholder and `postinstall: prisma generate` hook are already wired for a zero-friction upgrade.

## Adding a new app

1. Create `src/components/tools/<tool-id>.tsx` — a `'use client'` component with a default export.
2. Register it in `src/lib/tools/registry.tsx`: id, name, description, category, icon, gradient, glow, keywords and a lazy `Component`.
3. Done — it appears on the home screen, App Library, search and Settings automatically.
