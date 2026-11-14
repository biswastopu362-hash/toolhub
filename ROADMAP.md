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
- [x] **D30** Phase 2 QA Day — audit + fix + tag **v1.2**

## Phase 3 — Days 31–45 · "Media & Creative Powerhouse"

- [x] **D31** Screen Recorder (media) — display capture API, mic mix, preview + save to device
- [x] **D32** GIF Maker (media) — video segment → GIF, fps/size controls, from Camera/Gallery too
- [x] **D33** Video Converter & Compressor (media) — resolution/bitrate presets, progress UI
- [x] **D34** Video Studio v2 — multi-clip timeline strip, reorder, per-clip trim, combined export
- [x] **D35** Subtitle Studio (media) — SRT/VTT editor, timeline sync, preview overlay on video, export
- [x] **D36** Meme Maker (media) — top/bottom text, image picker, share-ready export
- [x] **D37** Collage Maker (media) — 8 layout grids, gap/radius controls, photos from Gallery
- [x] **D38** Design Studio template packs — posters, sale banners, YouTube thumbs, story packs (24+)
- [x] **D39** Wallpaper Studio (platform) — design your own launcher wallpaper (gradients/meshes),
      save into theme engine
- [x] **D40** Music Player v2 — playlists, shuffle/repeat, equalizer presets, sleep timer
- [x] **D41** Voice Recorder v2 — trim, rename, speed playback, notes per recording
- [x] **D42** Camera v2 — document scan mode (edge detect + flatten), timer, grid, mirror mode
- [x] **D43** Sticker Studio (media) — emoji/sticker sheets, transparent PNG export, use in design-studio
- [x] **D44** Font Playground (text) — font stacks preview, text-on-image quote cards
- [x] **D45** Phase 3 QA Day — audit + fix + tag **v1.3**

## Phase 4 — Days 46–60 · "Daily Life & Intelligence"

- [x] **D46** Weather v2 — hourly + 7-day charts, multiple saved locations, dynamic backdrops
- [x] **D47** Prayer Times (daily) — location-based schedule, Bengali labels, adhan reminder toggle
- [x] **D48** Health Tracker (daily) — BMI/BMR calculator, water intake tracker with day rings
- [x] **D49** Cycle Tracker (daily, private) — calendar predictions, notes, App Lock recommended badge
- [x] **D50** Workout Planner (daily) — routine builder, exercise timer with rest beeps, history
- [x] **D51** Recipe Box (daily) — recipes, ingredients checklist, meal planner week view
- [x] **D52** Shopping List (daily) — lists, check-off, quantity, share via Web Share
- [x] **D53** Travel & Fuel (calculator) — fuel cost, mileage, trip split, currency-aware
- [x] **D54** EMI/Loan v2 (calculator) — amortization chart, side-by-side loan comparison
- [x] **D55** Currency v2 — offline last-rates cache, favorites strip, swap animation
- [x] **D56** Random Tools (utilities) — dice, coin flip, wheel spinner, random name/number picker
- [x] **D57** Flashcards v2 — spaced repetition (SM-2 lite), due-queue, deck stats
- [x] **D58** AI Chat v2 — streaming responses, conversation history, system personas, markdown render
- [x] **D59** AI Writer (ai) — email/post/caption/summary generator with tone + length controls
- [x] **D60** Phase 4 QA Day — audit + fix + tag **v1.4**

## Phase 5 — Days 61–75 · "Games & OS Delight"

- [x] **D61** Sudoku (games) — 3 difficulties, notes mode, hint, timer
- [x] **D62** Minesweeper (games) — classic grid, flag mode toggle, best times
- [x] **D63** Snake (games) — swipe controls for mobile, speed levels, high score
- [x] **D64** Memory Match (games) — emoji/card themes, 2-player local mode
- [x] **D65** Bangla Wordle (games) — Bengali word guessing game, share result
- [x] **D66** 2P Arcade (games) — tic-tac-toe + connect-4, pass-and-play
- [x] **D67** Solitaire (games) — klondike, drag & drop, win animation
- [x] **D68** Trivia Quiz (games) — category packs, scoring streaks
- [x] **D69** Games hub polish — high-score center, achievements badges across all games
- [x] **D70** Share Target (platform) — PWA share_target manifest: receive text/files into Tools
- [x] **D71** Quick Actions (platform) — home-screen long-press menu, app shortcuts in manifest
- [x] **D72** Home Widgets (platform) — clock, weather, notes-sticky widgets on launcher pages
- [x] **D73** Notification Center (platform) — in-OS notification shade, reminders/events feed
- [x] **D74** Spotlight v2 — inline calculator, unit answers, deep app actions ("note: buy milk")
- [x] **D75** Phase 5 QA Day — audit + fix + tag **v1.5**

## Phase 6 — Days 76–90 · "Platform, Scale & Launch"

- [x] **D76** Accounts (platform) — optional NextAuth sign-in (Google), guest mode default
- [x] **D77** Cloud Sync — notes/reminders/settings sync for signed-in users (Prisma models)
- [x] **D78** i18n — full Bengali UI toggle (পূর্ণ বাংলা), language picker in Settings
- [x] **D79** Theme Engine v3 — custom accent color picker, icon shape (squircle/rounded/sharp),
      density option
- [x] **D80** Performance pass — bundle diet, lazy everything, Lighthouse ≥90 mobile, cold-start tune
- [x] **D81** Accessibility pass — focus rings, aria labels sweep, reduced-motion, contrast audit
- [x] **D82** Offline hardening — full offline data paths, SW update flow, "works on airplane" test
- [x] **D83** Admin Console v2 — linked-platform stats (opens/hides), reorder, bulk import/export
- [x] **D84** Linked Platforms v2 — per-platform deep links, embed-failure diagnostics, categories
- [x] **D85** Onboarding — first-run welcome tour, sample-data seeding, "Add to Home Screen" coach
- [x] **D86** Help & About (platform) — help app (FAQ, tips), privacy page, version changelog
- [x] **D87** Hardening — error boundaries per app, crash recovery, storage-quota handling
- [x] **D88** E2E Marathon — every app × {360, 390, 430, 768, 1280} viewport sweep, fix list closed
- [x] **D89** Release Candidate — **v2.0** changelog, metadata/screenshots, store description
- [x] **D90** Launch Day — final push, share the hub link, celebrate, draft v2.1 roadmap

---

## Phase 7 — v2.1 · "Reach & Rituals" (post-launch, pulled per week)

- [x] **P7-W1** Richer cloud sync: automatic (debounced) backup, games-scores domain, end-to-end encryption (AES-GCM, passphrase stays on device)
- [x] **P7-W2** Platform telemetry v2: per-day open chart in Admin Console, embed-check auto-run on save, broken-platform alerts
- [x] **P7-W3** Widget packs: calendar/agenda widget, habit-streak widget, goal progress ring — user-reorderable widget strip
- [x] **P7-W4** Spotlight plugins: currency conversion (offline rates table), color hex preview, unit math chaining
- [x] **P7-W5** App Lock v2: biometric (WebAuthn) unlock, per-folder locks
- [x] **P7-W6** Localization wave 2: Hindi + Spanish dictionaries
- [x] **P7-W7** Store v2: editorial collections, "similar apps" on detail pages, update-badges with changelog popups
- [x] **P7-W8** Performance: route-level prefetch warming, SW navigation preload + Phase 7 QA Day, tag **v2.1**

---

## Phase 8 — v2.2 · "Depth & Flow" (post-v2.1, pulled per week)

- [x] **P8-W1** Locale graduation I: shared Intl date/time layer (`localeTag`, `formatDateLang`) — Clock, Calendar, Notes, Reminders render bn/hi/es dates & digits natively
- [x] **P8-W2** Locale graduation II: Notes + Calculator + Clock app-internal strings join the 4-language dictionaries (compile-proven key coverage)
- [x] **P8-W3** Calculator Pro: scientific keypad (trig/log/pow/root), equation solver (quadratic + 2×2/3×3 linear systems), richer tape history
- [x] **P8-W4** Mind Map studio: node graph editor — radial layout, drag, per-branch colors, collapse/expand, JSON export/import
- [x] **P8-W5** Flowchart studio: shape palette (terminal/process/decision/io), SVG connectors with arrowheads, grid snap, JSON save/load
- [x] **P8-W6** Stats Plotter: table/paste data → line/bar/scatter/pie charts + summary stats (mean/median/mode/range/stddev)
- [x] **P8-W7** Journal: daily mood-tracked entries, streak strip, mood history visualization, search
- [x] **P8-W8** Time Tracker: project timers, today/week totals, history log + Phase 8 QA Day (90-app sweep, 3-viewport overflow), APP_VERSION 2.2.0 + CHANGELOG, tag **v2.2**

---

## The 100-Day Master Plan — "Road to v3.0" (P9–P18 · 100 waves · Day 91–190)

Drafted at the user's request right after the v2.2 launch of Phase 8. Three pillars govern this stretch:

- **Friendly** — the platform must feel effortless: onboarding v2/v3, coach marks, illustrated empty states, haptics & micro-interactions, WCAG AA, font scaling, themes v4, gesture polish, 4-language graduation.
- **Faultless** — find and fix every error: Diagnostics Center, three-wave catalog error sweep, crash telemetry charts, input/storage/offline hardening, performance budgets, zero-error QA gate at every phase close.
- **Advanced** — 10 brand-new tools (Flows, Shortcuts, API Client, SQL Playground, Webhook Inspector, AI Summarizer/Image Studio/Vision, Prompt Library, Documents Vault) plus 30+ pro-grade v2 upgrades across the existing 90-app catalog — shipping **v3.0** at a 100+ app catalog.

Cadence: 10 phases × 10 waves (1 wave = 1 day). The daily ritual never changes: tsc → lint → agent-browser E2E (360/390/1280) → worklog → ROADMAP tick → push. The last wave of each phase is a QA Day + tag.

### Phase 9 — v2.3 · "Fortify" (find & fix every error)

- [x] **P9-W1** Diagnostics Center (Admin Console tab): registry integrity, installed-vs-registry drift, storage quota, SW/cache health, orphan-data scan — live checks with auto-fix suggestions; fix all findings
- [x] **P9-W2** Catalog error sweep I: 30 apps deep QA (console + network + UX) at 360/390/1280, fix everything found
- [ ] **P9-W3** Catalog error sweep II: next 30 apps, same bar, fix everything found
- [ ] **P9-W4** Catalog error sweep III: final 30 apps + cross-app drills (copy→paste, share→open, lock→unlock), fix everything found
- [ ] **P9-W5** Crash & error telemetry: per-app error counts, 14-day trend chart, session health score in Admin Console
- [ ] **P9-W6** Input hardening: every form validated + sanitized, friendly inline errors, paste-sanitize, maxLength guards
- [ ] **P9-W7** Storage audit: store-migration test matrix, corrupt-data recovery drill, backup/restore E2E for all domains
- [ ] **P9-W8** Offline resilience: every app renders a graceful offline state, retry banners, SW update flow re-test, airplane-mode drill
- [ ] **P9-W9** Performance budgets: startup/interaction budgets per app, blur-budget respect on phones, fix all regressions
- [ ] **P9-W10** Phase 9 QA Day: full 90-app marathon, zero-error gate → tag **v2.3**

### Phase 10 — v2.4 · "Delight" (user-friendly wave)

- [ ] **P10-W1** Onboarding v2: per-app first-open tips, "what's new since v2.2" digest, discoverability nudges
- [ ] **P10-W2** Coach marks + tooltips: long-press menus, folders, widgets, dock, Spotlight — first-time hints everywhere
- [ ] **P10-W3** Empty states v2: illustrated premium empty states + one-tap sample data for every app
- [ ] **P10-W4** Micro-interactions: haptics (vibrate patterns), optional UI sounds, springy sheet/menu transitions
- [ ] **P10-W5** Accessibility I: contrast AA sweep, focus-ring consistency, screen-reader labels for every interactive element
- [ ] **P10-W6** Accessibility II: reduced-motion mode, 85–130% font scaling, 44px touch-target audit across shell + top apps
- [ ] **P10-W7** Themes v4: 8 new presets, live preview carousel, per-app accent override
- [ ] **P10-W8** Gestures v2: swipe-between-recents, pull-to-refresh shade, refined long-press quick menus
- [ ] **P10-W9** Help Center v2: searchable per-app guides + "advanced tools cookbook" seeds
- [ ] **P10-W10** Phase 10 QA Day + usability checklist (friendliness scorecard per app) → tag **v2.4**

### Phase 11 — v2.5 · "Creator Tools" (advanced upgrades I)

- [ ] **P11-W1** Code Editor v2: multi-tab sessions, find/replace, run-preview for HTML/Markdown, snippet library refresh
- [ ] **P11-W2** Regex Lab v2: pattern builder, replace preview, match explanations, cheat-sheet
- [ ] **P11-W3** Diff & Merge v2: side-by-side + unified views, per-hunk navigation, merge-to-result
- [ ] **P11-W4** Snippet Vault: tagged snippet library extracted from Code Editor (search, folders, import/export)
- [ ] **P11-W5** Text Forge v2: case/sort/dedupe/count consolidation, lorem generator, encode/decode suite
- [ ] **P11-W6** Markdown Studio v2: live outline, export to HTML/MD, image paste
- [ ] **P11-W7** Icon Forge: SVG icon composer → PNG set + favicon pack (new app)
- [ ] **P11-W8** Color Studio v2: palette generator, contrast checker, design-token export
- [ ] **P11-W9** Image Studio v2: batch compress/resize/convert with before-after preview
- [ ] **P11-W10** Phase 11 QA Day: upgraded-tools sweep → tag **v2.5**

### Phase 12 — v2.6 · "Dev Tools" (advanced upgrades II)

- [ ] **P12-W1** API Client: request runner (method/headers/body), response viewer, history, environments (new app)
- [ ] **P12-W2** JSON Formatter v2: JSONPath queries, schema inference, error pin-pointing
- [ ] **P12-W3** SQL Playground: in-browser SQLite (sql.js), sample DBs, saved queries (new app)
- [ ] **P12-W4** Cron & Timestamp v2: visual cron builder, next-runs preview, timezone-aware
- [ ] **P12-W5** Webhook Inspector: mock listener, request log, replay + cURL copy (new app)
- [ ] **P12-W6** JWT & Hash Suite v2: signature verify, claims table, checksum calculator
- [ ] **P12-W7** QR Studio v2: batch generation, logo embedding, camera scanner
- [ ] **P12-W8** Sheet Studio v2: pivot/join/dedupe, type inference, chart hand-off
- [ ] **P12-W9** Stats Plotter v2: area/pie themes, PNG export, dataset library
- [ ] **P12-W10** Phase 12 QA Day: upgraded-tools sweep → tag **v2.6**

### Phase 13 — v2.7 · "AI Studio" (advanced upgrades III)

- [ ] **P13-W1** AI Chat v2: streaming responses, system presets, conversation export
- [ ] **P13-W2** AI Writer v2: tone presets, rewrite/expand/shorten, side-by-side compare
- [ ] **P13-W3** AI Summarizer: paste/URL → TL;DR, key points, action items (new app)
- [ ] **P13-W4** Translator v2: tone-aware output, romanization, copy-ready blocks
- [ ] **P13-W5** AI Image Studio: text-to-image generation + edit presets (new app)
- [ ] **P13-W6** AI Vision: image Q&A, text/table extraction from photos (new app)
- [ ] **P13-W7** TTS Studio v2: multi-voice picker, speed control, audio download
- [ ] **P13-W8** Speech-to-Text v2: timestamps, speaker labels, export transcript
- [ ] **P13-W9** Prompt Library: templates with variables, favorites, run history (new app)
- [ ] **P13-W10** Phase 13 QA Day + backend guards (rate limit, error surface) → tag **v2.7**

### Phase 14 — v2.8 · "Media Lab" (advanced upgrades IV)

- [ ] **P14-W1** Voice Recorder v2: waveform trimming, markers, export
- [ ] **P14-W2** Audio Studio v2: speed/pitch/fade/normalize effects chain
- [ ] **P14-W3** Video Studio v2: segment trimming, preview scrub, export
- [ ] **P14-W4** Screen Recorder v2: mic mixing, format pick, countdown
- [ ] **P14-W5** PDF Tools v2: merge/split/rotate/reorder page grid
- [ ] **P14-W6** PDF Tools v2.1: annotate, highlight, e-sign, flattened export
- [ ] **P14-W7** Paint Studio v2: layers, text, filters, undo history
- [ ] **P14-W8** Image Studio v2.1: batch watermark/convert presets
- [ ] **P14-W9** GIF Maker v2: frame timeline, speed control, pixel-art mode
- [ ] **P14-W10** Phase 14 QA Day: low-end viewport budgets → tag **v2.8**

### Phase 15 — v2.9 · "Automate & Life" (new tools)

- [ ] **P15-W1** Flows engine: trigger → action graph editor with validation (new app)
- [ ] **P15-W2** Flow actions I: notify, clipboard, open app, copy field
- [ ] **P15-W3** Flow actions II: timers, conditions, variables, loops-lite
- [ ] **P15-W4** Shortcuts: run flows from Spotlight/Shade/quick actions (new app)
- [ ] **P15-W5** Scheduled automations + run-history logs
- [ ] **P15-W6** Flow templates gallery: ready-made recipes one tap away
- [ ] **P15-W7** Share sheet v2: system share target → route into any app/flow
- [ ] **P15-W8** Documents Vault: encrypted local store for sensitive notes/files (new app)
- [ ] **P15-W9** Money pack: Expense Tracker v2 (splits & bills) + Subscription tracker (new app)
- [ ] **P15-W10** Phase 15 QA Day: flow E2E scenarios → tag **v2.9**

### Phase 16 — v3.0-beta · "Ecosystem & Reach"

- [ ] **P16-W1** Widget packs v2: new widgets + visual widget editor
- [ ] **P16-W2** Spotlight plugins v2: unit/currency refresh, math chaining, app actions
- [ ] **P16-W3** Store v3: refreshed collections, screenshot carousels, "what's new" digest page
- [ ] **P16-W4** Developer mode: tool-pack format spec + sandboxed loader
- [ ] **P16-W5** Pack installer + sample pack (install external tool packs as JSON)
- [ ] **P16-W6** i18n graduation III: remaining core apps' internal strings join the 4-language dictionaries
- [ ] **P16-W7** i18n graduation IV: new tools (P11–P15) join the dictionaries; locale QA across bn/hi/es
- [ ] **P16-W8** Cloud sync v3: selective domain sync, conflict viewer, device names
- [ ] **P16-W9** App Lock v3: per-folder biometric, auto-lock policies, duress hint
- [ ] **P16-W10** Phase 16 QA Day → tag **v3.0-beta**

### Phase 17 — v3.0-rc · "Reach & Polish"

- [ ] **P17-W1** PWA reach: shortcuts v3, file/protocol handlers, share extensions audit
- [ ] **P17-W2** Update system: in-app changelog digest, migration notes, rollback-safe stores
- [ ] **P17-W3** Onboarding v3 + one-time feature-discovery hints for everything shipped in P9–P16
- [ ] **P17-W4** Perf sweep II: cold-start budget, bundle diet, lazy audit across all new tools
- [ ] **P17-W5** A11y final audit: WCAG AA across shell + top-25 apps
- [ ] **P17-W6** Full E2E marathon: every app × {360, 390, 430, 768, 1280}, zero errors
- [ ] **P17-W7** Bug bash: cross-app interaction drill + fix everything found
- [ ] **P17-W8** Docs: user manual + advanced-tools cookbook + developer docs
- [ ] **P17-W9** Data safety: export-everything, wipe, fresh-install + migration drill
- [ ] **P17-W10** Release candidate **v3.0-rc** + changelog + store metadata

### Phase 18 — v3.0 · "Launch"

- [ ] **P18-W1** RC feedback fixes wave
- [ ] **P18-W2** Launch assets: icons, banners, screenshots refresh
- [ ] **P18-W3** Final QA: Lighthouse ≥95 mobile, PWA checks, a11y green
- [ ] **P18-W4** Store listing refresh: every app's page reads well (120+ apps)
- [ ] **P18-W5** Launch rehearsal: fresh-profile E2E, airplane drill, low-end viewport
- [ ] **P18-W6** RC freeze + beta notes
- [ ] **P18-W7** v3.0 freeze + credits + final changelog
- [ ] **P18-W8** Buffer day (overflow from any phase)
- [ ] **P18-W9** Launch-week comms draft (share copy, changelog page)
- [ ] **P18-W10** **LAUNCH v3.0** — tag, push, celebration toast + draft next horizon

**Success criteria (end of Day 100):** 100+ app catalog (90 existing + 10 new) · every existing tool upgraded or error-swept · zero known errors · 4 languages across chrome + core apps · WCAG AA · Lighthouse ≥95 mobile · **v3.0 shipped**.

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
