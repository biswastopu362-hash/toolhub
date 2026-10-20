# টুলহাব (ToolHub) — Worklog

All-in-One PWA Toolbox. Single-route Next.js 16 app (only `/`), hash-based tool views (#/tool/<id>), Bengali-first UI, emerald/teal theme, offline-capable PWA.

---
Task ID: 2
Agent: main (Z.ai Code)
Task: Project analysis, architecture design, core foundation

Work Log:
- Explored existing Next.js 16 + shadcn/ui + Tailwind 4 scaffold
- Designed tool-registry architecture: src/lib/tools/registry.ts + types.ts (add new tools by adding one registry entry + one component file)
- Created PWA setup: src/app/manifest.ts, public/sw.js (offline app shell), AI-generated icons (icon-192/512, maskable, apple-touch, favicon)
- Created src/lib/store/app-store.ts (zustand persist: favorites + recents)
- Created src/hooks/use-hash-route.ts (hash router on single "/" route)
- Updated src/app/layout.tsx (Bengali font Noto Sans Bengali, theme provider, SW registration, PWA metadata)
- Updated src/app/globals.css (emerald/teal palette light+dark, custom scrollbars)
- Built src/app/page.tsx: header (theme toggle, offline badge, install button), hero, search, category chips, favorites, recents, tool grid, tool view with related tools, sticky footer
- Wrote reference tool components: src/components/tools/calculator.tsx (full expression engine) and unit-converter.tsx (10 categories incl. কাঠা/বিঘা/মণ)

Stage Summary:
- ARCHITECTURE CONTRACT for new tools:
  - File: src/components/tools/<tool-id>.tsx, default export React component, 'use client'
  - Register in src/lib/tools/registry.ts: id, nameBn, nameEn, descBn, category, icon (lucide), gradient (tailwind classes), keywords, Component (via `load(() => import(...))`)
  - Client-side only, shadcn/ui components, Bengali labels, responsive (mobile-first), long lists need max-h + overflow-y-auto
  - Categories: calculator | converter | generator | text | developer | daily

---
Task ID: 4-a
Agent: full-stack-developer
Task: Built 4 generator/developer tools (password-generator, qr-generator, json-formatter, base64-tool)

Work Log:
- Read worklog.md ARCHITECTURE CONTRACT + verified registry.tsx imports (4 default-export components at src/components/tools/<id>.tsx), shadcn/ui component APIs (slider/select/tabs/alert/checkbox/switch), tsconfig strictness and eslint config (react-hooks/set-state-in-effect active)
- password-generator.tsx: crypto.getRandomValues with rejection sampling (no modulo bias), length slider 6–64 (Bengali digits via toBn), 5 charset checkboxes incl. confusable-exclusion, 4-level entropy strength bar (দুর্বল/মোট/ভাল/দুর্দান্ত) + rough Bengali crack-time estimate, destructive Alert when no charset, last-5 history (click to re-select, per-item copy), useToast feedback
- qr-generator.tsx: qrcode.toDataURL (width/margin/EC/color), Tabs টেক্সট/লিংক + ওয়াইফাই (SSID, show/hide password, WPA/WEP/ছাড়া select, hidden switch, WIFI: string with \\ ; , : " escaping), size 256/512/1024 + EC L/M/Q/H + dark/light color pickers (#134e4a/#ffffff defaults), debounced 300ms live generation in useEffect with cancelled-flag stale guard (setState only inside async callbacks — no sync setState in effect body), empty-input hint, error Alert, PNG download via programmatic <a download="qr-code.png">, copy payload
- json-formatter.tsx: pretty/minify with 2/4-space/tab indent Select, Bengali sample loader, clear + copy, JSON.parse in try/catch → destructive Alert with message + "position N" → line/column extraction, green "বৈধ JSON ✓" Badge + stats row (TextEncoder bytes, line count, top-level keys/items), output in max-h-72 overflow-y-auto mono pre
- base64-tool.tsx: 3 tabs (টেক্সট→Base64 / Base64→টেক্সট / URL এনকোড), Unicode-safe encode via TextEncoder + chunked (32k) String.fromCharCode → btoa, decode via atob → Uint8Array → TextDecoder with "ভ্যালিড Base64 নয়" destructive Alert, URL tab with encode/decode segmented toggle + URIError handling, live derived conversion via useMemo (no effects), Swap button (output→input + flips direction/tab), Copy/Clear, input vs output byte-length info
- Verified only these 4 files touched; ran `bun run lint` (0 errors) and `bunx tsc --noEmit` (no errors in src/; only pre-existing examples/skills errors)

Stage Summary:
- 4 tools production-ready under the registry contract: default-export client components, shadcn/ui only + lucide icons (+ qrcode pkg for QR), Bengali-first, mobile-first responsive (grid-cols-1 sm:grid-cols-2), h-11 (44px) touch targets, aria-labels on all interactive elements, max-h + overflow-y-auto on long lists/outputs, custom scrollbar inherited from globals.css
- ESLint rule compliance pattern established for future agents: never call setState synchronously in useEffect bodies — use setTimeout-in-effect with cleanup (password init/option-change regen), async promise callbacks with cancelled-flag guards (debounced QR), or fully derived useMemo state (base64 live conversion)
---
Task ID: 4-b
Agent: full-stack-developer
Task: Built 4 daily/text tools (age-calculator, emi-calculator, text-tools, color-tool)

Work Log:
- Read worklog.md ARCHITECTURE CONTRACT + registry.tsx, lib/bn.ts, hooks/use-toast.ts and calculator.tsx reference for conventions
- age-calculator.tsx: native date inputs (জন্মতারিখ + হিসাবের তারিখ, today via lazy useState initializer with typeof window guard); calendar-accurate Y/M/D via addMonthsClamped anchors (handles Jan 31 + 1 month, Feb 29); destructive Alert when birth > target ("জন্মতারিখ ভবিষ্যতে হতে পারে না"); gradient highlight card + stat grid (মোট মাস/সপ্তাহ/দিন/ঘণ্টা/মিনিট, toBn digits); next-birthday card with Bengali weekday, days remaining, "শুভ জন্মদিন! 🎂" festive state when until === 0; empty-state hint before a date is picked; all derived via useMemo (no setState in effects)
- emi-calculator.tsx: amount/rate/tenure inputs + Select unit (বছর/মাস); EMI = P·r·(1+r)^n/((1+r)^n−1) with r=0 → P/n fallback; monthly loop builds yearly amortization rows (interest_m = balance·r, last-month balance adjustment); results: primary-highlight EMI card, মোট সুদ, মোট পরিশোধ in "৳ " + Math.round(x).toLocaleString('en-IN'); stacked principal/interest bar (bg-primary + bg-amber-500) with legend; Collapsible "বিস্তারিত পরিশোধ তালিকা দেখুন" with sticky-header table in max-h-72 overflow-y-auto; validation hints per input (amount ≤ 0, rate range, tenure 1–1200 months) with graceful hint card instead of crash
- text-tools.tsx: Textarea min-h-[140px] with 5 live stat chips (অক্ষর, শব্দ via /\s+/ filter, বাক্য split on [.!?।], প্যারাগ্রাফ, পড়ার সময় words/200 min, toBn digits); 11 transform buttons (2-col mobile → 4-col desktop, h-11 touch targets): UPPER/lower/sentence-case (Bengali দাড়ি aware)/Title case (per-word first-char, script-agnostic), collapse spaces, join lines, drop empty lines, sort lines localeCompare('bn'), dedupe lines (Set), Bengali "১. " line numbers via toBn, reverse via Array.from; toast "রূপান্তর হয়েছে" per transform; ফলাফল কপি (clipboard API + toast) and সব মুছুন actions
- color-tool.tsx: Input type=color + hex text input validating /^#?[0-9a-fA-F]{6}$/ (lastValid state updated in handlers, not effects); hand-rolled hex→rgb→hsl (standard formulas) + rgbToCmyk, hslToRgb for complement; WCAG relative-luminance preview swatch labeled গাঢ় রং/হালকা রং with contrast-safe text; HEX/RGB/HSL/CMYK mono rows each with h-11 icon copy button + useToast; 10-step tint/shade palette (5 mixes toward white, 5 toward black) — scrollable row on mobile, grid-cols-10 on desktop, click-to-copy with title/aria; complementary (hue+180) card with copy; "র‍্যান্ডম রং" button using crypto.getRandomValues(3 bytes)
- Verification: bun run lint → 0 errors; bunx tsc --noEmit → no errors in src/ (only pre-existing examples/skills errors); GET / → 200, no module-not-found after files were written

Stage Summary:
- All 4 registry-wired tools now fully functional client-side (no server calls, no Prisma, no new routes), Bengali-first labels, Bengali digits via toBn, mobile-first responsive, 44px touch targets, aria-labels, long tables scrollable with max-h
- Contract kept: each file has 'use client' + default export (AgeCalculatorTool, EmiCalculatorTool, TextToolsTool, ColorToolTool); only shadcn/ui + lucide-react + @/lib/bn + @/lib/utils + @/hooks/use-toast imports; registry untouched

---
Task ID: 4-a
Agent: full-stack-developer
Task: Built 4 generator/developer tools (password-generator, qr-generator, json-formatter, base64-tool)

Work Log:
- Read worklog.md architecture contract
- password-generator: crypto.getRandomValues + rejection sampling, entropy strength meter, 5 charset options, history
- qr-generator: qrcode lib, Text/URL + WiFi tabs (WIFI: string escaping), size/EC/color controls, PNG download
- json-formatter: format/minify/validate with error position extraction, indent select, stats row
- base64-tool: Unicode-safe chunked btoa/atob, URL tab, live useMemo conversion, swap

Stage Summary:
- 4 tool files created per contract; lint passed (0 errors); tsc clean; registry untouched

---
Task ID: 5-6
Agent: main (Z.ai Code)
Task: Integration, verification and browser E2E testing

Work Log:
- Fixed lint issues: registry.ts -> registry.tsx (JSX), react-hooks/set-state-in-effect via useHydrated hook (useSyncExternalStore) and lazy state initializers
- Full lint pass: 0 errors
- Agent Browser E2E verification ALL PASSED:
  - Home renders (hero, search, 6 category chips with counts, tool grid)
  - Calculator: 7 x 8 = 56 correct, history recorded, keypad + DEG/RAD
  - Unit converter: 2 km = 2,000 m, all-unit table, 10 categories
  - QR generator: URL -> live QR rendered, PNG download present
  - Password generator: 16-char strong password generated, entropy meter
  - EMI: 500000 @ 9% / 5y -> ৳10,379 monthly (verified correct)
  - Age: 2000-05-15 -> ২৬ বছর ৫ মাস ৫ দিন, next birthday Saturday
  - Text tools: uppercase transform works; Color: #FF6600 -> rgb(255,102,0); JSON format valid; Base64 Bengali UTF-8 encode correct
  - Favorites + recents sections appear after starring
  - Dark mode toggle works; iPhone 15 viewport responsive; footer sticks to bottom on mobile and desktop
  - Service worker registered (1), /manifest.webmanifest 200, install prompt available
  - No console errors (only React DevTools info + HMR)

Stage Summary:
- App complete and browser-verified: 10 working tools on single "/" route with hash views #/tool/<id>
- PWA installable + offline-capable; zero console/runtime errors
