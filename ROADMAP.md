# ToolHub — 90-Day Development Roadmap

> Mission: build the world's most complete mobile-OS-style PWA super-app — one link that carries
> the owner's entire app ecosystem, with premium native-grade graphics, total privacy (zero uploads),
> and a best-in-class experience on every screen size.
>
> Cadence: **90 days · one meaningful deliverable every day.** This document is the single source of
> truth; every session starts by reading it plus `worklog.md`, and every finished day gets a checkbox.

---

## 0. Where we are today (Day 0 baseline)

**The OS platform**

- Home launcher: multi-page grid, drag & drop reorder, folders, dock, Spotlight, App Library,
  Control Center, 12 eye-comfort wallpapers, light/dark themes, jiggle edit-mode, iPad-style
  minimize animation, sticky footer, 360→1920px responsive
- App Store: featured carousel, categories, search, detail pages, My Apps, ratings — installs from
  the store appear on home; uninstall via jiggle mode
- **Linked Platforms** (Task 18): admin-curated external PWAs stored in Prisma/SQLite, admin
  passcode + HMAC session, embedded window with new-tab fallback, auto-pruned shortcuts
- PWA: manifest, offline shell SW, install support, hash router on the single `/` route
- 34 built-in apps + dynamic linked platforms (35+ catalog)

**Built-in apps by category (current)**

| Category | Apps |
|---|---|
| media | gallery, camera, video-studio, video-player, music-player, paint-studio, design-studio (v2.1), image-tools, voice-recorder |
| productivity | sheet-studio, pdf-tools |
| daily | calendar, goal-tracker, clock, weather, notes, reminders, currency, emi-calculator, age-calculator |
| utilities | files, qr-generator, password-generator, base64-tool, color-tool, device-info, settings |
| text | text-tools |
| developer | json-formatter |
| ai | ai-chat |
| games | game-2048 |
| system | store, admin-console |

---

## 1. Non-negotiable principles (every single day)

1. **Mobile-first responsive** — verify at 360×740, 390×844, 430×932 AND 1280×800 every day
2. **Premium native feel** — dark-glass workspaces, gradient identity, framer-motion transitions;
   it must never feel like a website
3. **Zero uploads** — all processing client-side; server only exists for Linked Platforms + AI
4. **English UI** (Bengali toggle planned in Phase 6)
5. **Quality gates before any commit**: `bunx tsc --noEmit` → `bun run lint` → agent-browser E2E
   → `git status --short` mode-drift check → worklog entry → push
6. **One registry entry = one app** — new app = new `src/components/tools/<id>.tsx` + registry row
7. Long lists: `max-h-96 overflow-y-auto` + custom scrollbar; 44px touch targets everywhere

**Daily session ritual:** read `ROADMAP.md` + `worklog.md` → implement today's item → verify →
commit → append worklog → tick the checkbox here.

---

## 2. Category coverage map (current → 90-day target)

| Category | Now | Adding (highlights) | Day-90 |
|---|---|---|---|
| media | 9 | audio-studio, screen-recorder, gif-maker, video-converter, collage, meme-maker, subtitle-tool, metronome, stickers | ~18 |
| productivity | 2 | presentation-studio, resume-builder, invoice-generator, markdown-pro, business-card, kanban | ~8 |
| daily | 9 | expense-tracker, habit-tracker, flashcards, shopping-list, prayer-times, health suite, workout, recipes | ~17 |
| utilities | 7 | compass, random-tools, wifi-qr, magnifier | ~11 |
| text | 1 | translator, tts-studio, speech-to-text, word-counter, ai-writer | ~6 |
| developer | 1 | diff-checker, regex-tester, hash-uuid, jwt-decoder, cron-parser, code-editor, image-optimizer | ~8 |
| calculator | 1 | tip/discount/fuel, loan-comparison, bmi | ~5 |
| games | 1 | sudoku, minesweeper, snake, memory, bangla-wordle, 2P games, solitaire, trivia | ~9 |
| ai | 1 | ai-chat v2, ai-writer | ~3 |
| **platform (OS)** | — | app-lock, backup/restore, widgets, notification center, share target, accounts, sync, i18n, onboarding | 8+ features |

Target: **~80+ apps & features** by Day 90.

---

## Phase 1 — Days 1–15 · "Raise the floor" (core depth + most-wanted gaps)

- [x] **D1** Expense Tracker (daily) — income/expense entries, categories, monthly budget, charts
      (recharts), IndexedDB persistence, dark-glass finance look
- [x] **D2** Notes v2 — folders, pinned notes, search, markdown-lite rendering, note colors, export
- [x] **D3** Clock v2 — stopwatch with laps, countdown timer with alarm ring, world clock strip
- [x] **D4** Translator (text) — AI-backed translation card, copy/share, language picker, history
- [x] **D5** TTS Studio (text) — text→speech with voice/speed picker, play + download where supported
- [x] **D6** Speech-to-Text (text) — mic → live transcript, save into Notes; hands-free voice notes
- [x] **D7** Image Tools v2 "Photo Editor" — crop, rotate, brightness/contrast/saturation, filter
      presets, before/after slider, save to Gallery
- [x] **D8** Audio Studio (media) — trim/merge/convert audio, waveform UI, export webm/mp3-able
- [x] **D9** App Lock (platform) — optional PIN gate for chosen apps, lock settings integration
- [x] **D10** Backup & Restore (platform) — export all localStorage/IndexedDB app data to a JSON
      file; restore on a new device; privacy note (file never leaves device)
- [x] **D11** Flashcards (daily) — deck builder, flip animation, self-grading, progress stats
- [x] **D12** Habit Tracker (daily) — habits grid, streaks, 30-day heatmap, daily check reminders
- [x] **D13** Compass & Level (utilities) — device orientation, bubble level, true-north readout
- [x] **D14** Metronome & Tuner (media) — BPM tap, time signatures, mic pitch tuner
- [x] **D15** Phase 1 QA Day — full audit: tsc/lint/browser sweep of ALL apps ×390/1280, fix
      everything, tag **v1.1**

## Phase 2 — Days 16–30 · "Productivity Suite" (Office-class coverage)

- [x] **D16** Presentation Studio (productivity) — slide editor reusing design-studio engine,
      16:9 canvas, text/shapes/images, slide sorter
- [x] **D17** Presentation Studio II — 6 pro templates, presenter mode (fullscreen + next-slide),
      export PDF deck
- [x] **D18** Resume Builder (productivity) — 3 templates, sectioned form, live A4 preview, PDF export
- [x] **D19** Invoice Generator (productivity) — line items, tax/discount, logo upload, branded PDF
- [x] **D20** Markdown Studio (text) — editor + live preview, export HTML/PDF, draft autosave
- [x] **D21** Diff Checker (developer) — side-by-side + unified view, line/word highlight, copy result
- [x] **D22** Regex Tester (developer) — pattern input, flags, match table, live highlighting,
      cheat-sheet drawer
- [x] **D23** Hash & UUID (developer) — SHA-1/256/512, MD5 via WebCrypto where possible, UUID v4,
      batch generate + copy
- [x] **D24** JWT Decoder (developer) — decode header/payload, expiry warnings, no verification (privacy)
- [x] **D25** Cron & Timestamp (developer) — cron expression parser with human description + next runs;
      epoch ⇄ date converter
- [x] **D26** Code Editor mini (developer) — syntax-highlighted editing, snippet library, share as file
- [x] **D27** Task Board (daily) — kanban columns, drag between columns, due dates; complements reminders
- [x] **D28** Business Card Maker (design-studio template pack) — 6 templates, front/back, PNG/PDF
- [x] **D29** QR Studio v2 (utilities) — WiFi QR, vCard contact QR, bulk CSV→QR, scan history
- [ ] **D30** Phase 2 QA Day — audit + fix + tag **v1.2**

## Phase 3 — Days 31–45 · "Media & Creative Powerhouse"

- [ ] **D31** Screen Recorder (media) — display capture API, mic mix, preview + save to device
- [ ] **D32** GIF Maker (media) — video segment → GIF, fps/size controls, from Camera/Gallery too
- [ ] **D33** Video Converter & Compressor (media) — resolution/bitrate presets, progress UI
- [ ] **D34** Video Studio v2 — multi-clip timeline strip, reorder, per-clip trim, combined export
- [ ] **D35** Subtitle Studio (media) — SRT/VTT editor, timeline sync, preview overlay on video, export
- [ ] **D36** Meme Maker (media) — top/bottom text, image picker, share-ready export
- [ ] **D37** Collage Maker (media) — 8 layout grids, gap/radius controls, photos from Gallery
- [ ] **D38** Design Studio template packs — posters, sale banners, YouTube thumbs, story packs (24+)
- [ ] **D39** Wallpaper Studio (platform) — design your own launcher wallpaper (gradients/meshes),
      save into theme engine
- [ ] **D40** Music Player v2 — playlists, shuffle/repeat, equalizer presets, sleep timer
- [ ] **D41** Voice Recorder v2 — trim, rename, speed playback, notes per recording
- [ ] **D42** Camera v2 — document scan mode (edge detect + flatten), timer, grid, mirror mode
- [ ] **D43** Sticker Studio (media) — emoji/sticker sheets, transparent PNG export, use in design-studio
- [ ] **D44** Font Playground (text) — font stacks preview, text-on-image quote cards
- [ ] **D45** Phase 3 QA Day — audit + fix + tag **v1.3**

## Phase 4 — Days 46–60 · "Daily Life & Intelligence"

- [ ] **D46** Weather v2 — hourly + 7-day charts, multiple saved locations, dynamic backdrops
- [ ] **D47** Prayer Times (daily) — location-based schedule, Bengali labels, adhan reminder toggle
- [ ] **D48** Health Tracker (daily) — BMI/BMR calculator, water intake tracker with day rings
- [ ] **D49** Cycle Tracker (daily, private) — calendar predictions, notes, App Lock recommended badge
- [ ] **D50** Workout Planner (daily) — routine builder, exercise timer with rest beeps, history
- [ ] **D51** Recipe Box (daily) — recipes, ingredients checklist, meal planner week view
- [ ] **D52** Shopping List (daily) — lists, check-off, quantity, share via Web Share
- [ ] **D53** Travel & Fuel (calculator) — fuel cost, mileage, trip split, currency-aware
- [ ] **D54** EMI/Loan v2 (calculator) — amortization chart, side-by-side loan comparison
- [ ] **D55** Currency v2 — offline last-rates cache, favorites strip, swap animation
- [ ] **D56** Random Tools (utilities) — dice, coin flip, wheel spinner, random name/number picker
- [ ] **D57** Flashcards v2 — spaced repetition (SM-2 lite), due-queue, deck stats
- [ ] **D58** AI Chat v2 — streaming responses, conversation history, system personas, markdown render
- [ ] **D59** AI Writer (ai) — email/post/caption/summary generator with tone + length controls
- [ ] **D60** Phase 4 QA Day — audit + fix + tag **v1.4**

## Phase 5 — Days 61–75 · "Games & OS Delight"

- [ ] **D61** Sudoku (games) — 3 difficulties, notes mode, hint, timer
- [ ] **D62** Minesweeper (games) — classic grid, flag mode toggle, best times
- [ ] **D63** Snake (games) — swipe controls for mobile, speed levels, high score
- [ ] **D64** Memory Match (games) — emoji/card themes, 2-player local mode
- [ ] **D65** Bangla Wordle (games) — Bengali word guessing game, share result
- [ ] **D66** 2P Arcade (games) — tic-tac-toe + connect-4, pass-and-play
- [ ] **D67** Solitaire (games) — klondike, drag & drop, win animation
- [ ] **D68** Trivia Quiz (games) — category packs, scoring streaks
- [ ] **D69** Games hub polish — high-score center, achievements badges across all games
- [ ] **D70** Share Target (platform) — PWA share_target manifest: receive text/files into Tools
- [ ] **D71** Quick Actions (platform) — home-screen long-press menu, app shortcuts in manifest
- [ ] **D72** Home Widgets (platform) — clock, weather, notes-sticky widgets on launcher pages
- [ ] **D73** Notification Center (platform) — in-OS notification shade, reminders/events feed
- [ ] **D74** Spotlight v2 — inline calculator, unit answers, deep app actions ("note: buy milk")
- [ ] **D75** Phase 5 QA Day — audit + fix + tag **v1.5**

## Phase 6 — Days 76–90 · "Platform, Scale & Launch"

- [ ] **D76** Accounts (platform) — optional NextAuth sign-in (Google), guest mode default
- [ ] **D77** Cloud Sync — notes/reminders/settings sync for signed-in users (Prisma models)
- [ ] **D78** i18n — full Bengali UI toggle (পূর্ণ বাংলা), language picker in Settings
- [ ] **D79** Theme Engine v3 — custom accent color picker, icon shape (squircle/rounded/sharp),
      density option
- [ ] **D80** Performance pass — bundle diet, lazy everything, Lighthouse ≥90 mobile, cold-start tune
- [ ] **D81** Accessibility pass — focus rings, aria labels sweep, reduced-motion, contrast audit
- [ ] **D82** Offline hardening — full offline data paths, SW update flow, "works on airplane" test
- [ ] **D83** Admin Console v2 — linked-platform stats (opens/hides), reorder, bulk import/export
- [ ] **D84** Linked Platforms v2 — per-platform deep links, embed-failure diagnostics, categories
- [ ] **D85** Onboarding — first-run welcome tour, sample-data seeding, "Add to Home Screen" coach
- [ ] **D86** Help & About (platform) — help app (FAQ, tips), privacy page, version changelog
- [ ] **D87** Hardening — error boundaries per app, crash recovery, storage-quota handling
- [ ] **D88** E2E Marathon — every app × {360, 390, 430, 768, 1280} viewport sweep, fix list closed
- [ ] **D89** Release Candidate — **v2.0** changelog, metadata/screenshots, store description
- [ ] **D90** Launch Day — final push, share the hub link, celebrate, draft v2.1 roadmap

---

## 3. Backlog pool (pull from here when a day finishes early)

- Image optimizer/compressor · Favicon generator · Lorem ipsum · SQL formatter · Palette generator
- Metronome sound packs · Podcast player · Radio streams · Mind map · Flowchart studio
- Graph/statistics plotter · Scientific calculator mode · Equation solver · Matrix calculator
- Barcode scanner · NFC tools · WiFi analyzer (where APIs allow) · Data breach checker (offline mock)
- Sketch AR tracer · Pixel art editor · Coloring book · Piano · Drum pad · Karaoke-lite
- Streak calendar · Journal with mood tracking · Dream log · Time tracker · Pomodoro OS-wide
- Family expense split · Bill reminder · Subscription tracker · Warranty cards · Documents vault

## 4. Weekly rhythm (independent of phase)

| Day | Extra duty on top of the daily item |
|---|---|
| Every day | gates: tsc → lint → E2E → mode-drift check → worklog → push |
| Monday | performance spot-check (bundle size, dev.log errors) |
| Wednesday | responsive sweep at 360px for yesterday's app |
| Friday | release-tag checkpoint if phase is mid-flight; changelog notes |
| Sunday | catalog-wide browser sweep (open every app once, fix what's broken) |

## 5. Definition of Done (any app/feature)

1. Feature complete per its day's scope; premium dark-glass styling consistent with siblings
2. Responsive verified at 360/390/430/1280; 44px targets; long lists scroll with styled scrollbars
3. `bunx tsc --noEmit` clean · `bun run lint` clean · zero console/page errors in agent-browser
4. Data persists where expected (IndexedDB/localStorage/Prisma); empty states are premium
5. Registry entry (icon, gradient, glow, keywords, version) · store page reads well
6. worklog entry with Task ID · ROADMAP.md checkbox ticked · pushed to GitHub

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Browser API gaps on mobile (File System Access, Screen Capture) | Always ship import/picker fallbacks; mark desktop-only paths clearly |
| Vercel serverless limits (in-memory transfer relay, AI latency) | Swap relay to Blob/KV when needed (D84 window); keep AI calls thin |
| IndexedDB/localStorage quota | Compress data URLs, quota handler + user-facing cleanup in Settings |
| Scope creep per day | One item per day, hard stop; overflow → backlog pool |
| Mode-drift regressions on commit | `git status --short` check inside every session's commit ritual |
