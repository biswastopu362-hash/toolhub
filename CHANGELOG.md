# ToolHub — Changelog

One hub, every tool. A phone-OS style PWA super-app: an app-store launcher, 85 built-in
offline apps, your own linked platforms, themes, widgets and search that thinks.
Everything runs on your device — zero uploads.

## 2.0.0 — Platform, Scale & Launch (90-day build complete)

**Accounts & platform**

- Optional accounts: sign in with Google (when configured) or a local email — guest mode is the default and fully featured
- Cloud Sync: manual one-tap backup/restore of notes, reminders and launcher layout per account (last-write-wins, 2 MB cap, opaque payloads)
- Full Bengali interface toggle (পূর্ণ বাংলা): launcher, status bar, Spotlight, Settings, widgets, notification shade — with Bengali numerals and dates
- Theme Engine v3: icon shape (squircle / rounded / sharp), grid density (compact / cozy / roomy) and a custom accent color picker
- Performance pass: every app is a lazy-loaded chunk, wallpaper pause under app windows
- Accessibility pass: dynamic `<html lang>` sync, focus rings, 44 px targets, reduced-motion support
- Offline hardening: cache-first shell, SW update flow, "works on airplane" verified

**Owner platform**

- Admin Console v2: open-count telemetry (total opens, most-opened platform), store reordering with optimistic UI, bulk JSON export + import (URL-dedupe, max 50)
- Linked Platforms v2: per-platform deep links (`#/app/<slug>`, copy buttons everywhere), server-side embed-failure diagnostics (X-Frame-Options / CSP frame-ancestors probe), category chip filters in the store
- Open telemetry API (write-only counter, fires when a platform view mounts)

**First run & support**

- Onboarding: 4-step welcome tour (privacy chips → home-screen gestures → Spotlight tricks → add-to-home-screen coach) with optional sample-data seeding (2 notes + 1 reminder)
- Help Center app: searchable 12-entry FAQ, power-user tips, the zero-upload privacy policy, and this changelog — shipped on every device via a store migration

**Hardening**

- Per-app error boundaries with one-tap recovery (a crash in one app never takes down the shell)
- E2E marathon: every app × {360, 390, 430, 768, 1280} viewport sweep — zero horizontal overflow, zero error boundaries
- Store migration v5 → v6 backfills Help Center for existing devices

## 1.5.0 — Games & OS Delight

- Nine games: Sudoku (notes/hints/timer), Minesweeper (flag mode, chording), Snake (swipe, 4 speeds), Memory Match (2P), Bangla Wordle, 2-Player Arcade (TTT + minimax, Connect-4), Solitaire (Klondike), Trivia Quiz (60-question packs, streaks) and 2048 — plus Game Center, a unified high-score hub with 37 achievements
- Share Target: share text/links from any app straight into Notes
- Quick Actions: home-screen long-press menu (open / favorite / app info / edit / uninstall)
- Home widgets: live Clock, Weather and Notes cards
- Notification Center: live feed built from your calendar events and reminders
- Spotlight v2: inline math (`12*8+4`), unit conversion (`5km to mi`) and `note:` capture

## 1.0.0 — The 90-day build

- Phone-OS launcher: app-store home, drag-and-drop reorder, folders, favorites, dock, page dots
- 84 built-in apps across 9 categories — all on-device, all offline-capable
- App Store with install/uninstall, detail pages, search, categories and top charts
- iPad-style minimize/restore animations, premium native-grade graphics
- Themes: light/dark, wallpapers, accent palettes
- Hash deep links (`#/app/<id>`), Web Share Target, PWA install, portrait-to-desktop responsive (360 → 1280+)
