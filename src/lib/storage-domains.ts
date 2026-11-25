'use client'

/* ================================================================== */
/* Storage domain map — P9-W7 ("Fortify" wave 7).                      */
/*                                                                     */
/* Single source of truth for every data domain ToolHub owns: the      */
/* localStorage keys, the dynamic key prefixes, and the IndexedDB      */
/* databases with their store shapes. Consumed by the Backup &         */
/* Restore app (what to pack / restore) and the Admin Console's        */
/* Storage Audit (prove the map covers every discovered domain —       */
/* an unknown domain would silently escape backups).                   */
/* ================================================================== */

export interface LsMeta {
  label: string
  hint: string
  /** true → known to the map but deliberately NOT packed/restored (transient state). */
  exclude?: boolean
}

export const LS_KEYS: Record<string, LsMeta> = {
  'toolhub-store': { label: 'System & home screen', hint: 'wallpaper, accent, layout, installed apps, App Lock' },
  'toolhub-notes': { label: 'Notes', hint: 'all notebooks content' },
  'toolhub-notes-folders': { label: 'Notes folders', hint: 'folder list, icons & counts' },
  'toolhub-reminders': { label: 'Reminders', hint: 'tasks and due dates' },
  'toolhub-calc-history': { label: 'Calculator history', hint: 'past calculations' },
  'toolhub-sheet-draft': { label: 'Spreadsheet draft', hint: 'auto-saved workbook state' },
  'toolhub-goals:v1': { label: 'Goal tracker', hint: 'goals and progress' },
  'toolhub.ai-chat.messages': { label: 'AI Assistant chats', hint: 'conversation history' },
  'toolhub.music-player.state': { label: 'Music player state', hint: 'queue & playback position' },
  'toolhub.calendar.events': { label: 'Calendar events', hint: 'events and reminders' },
  'toolhub.2048.best': { label: '2048 best score', hint: 'high score' },
  'toolhub-translator-prefs': { label: 'Translator preferences', hint: 'language pair' },
  'toolhub-translator-history': { label: 'Translator history', hint: 'past translations' },
  'toolhub-tts-prefs': { label: 'Text-to-Speech preferences', hint: 'voice & speed' },
  'toolhub-tts-history': { label: 'Text-to-Speech history', hint: 'generated speech items' },
  'toolhub-stt-lang': { label: 'Speech-to-Text language', hint: 'recognition language' },
  'toolhub-stt-history': { label: 'Speech-to-Text history', hint: 'past transcriptions' },
  'toolhub-canva:draft:v1': { label: 'Design draft (legacy)', hint: 'old localStorage draft' },
  'toolhub.mode': { label: 'Theme mode', hint: 'light / dark / amoled / system' },
  'toolhub.accent': { label: 'Accent color', hint: 'system-wide color palette' },
  'toolhub-install-banner-dismissed': { label: 'Install banner', hint: 'dismissed state' },
  'currency-rates': { label: 'Currency rates cache', hint: 'offline exchange rates' },
  'weather-cache': { label: 'Weather cache', hint: 'recent forecasts' },
  'weather-unit': { label: 'Weather units', hint: '°C / °F preference' },
  /* P9-W7 audit finds: platform keys the original map predated — real data,
   * now included so backup/restore covers the whole surface. */
  'toolhub.telemetry.v1': { label: 'Usage telemetry', hint: 'per-day opens (30-day window)' },
  'toolhub.crashes.v1': { label: 'Crash telemetry', hint: 'error history + session health' },
  'toolhub.notifs': { label: 'Notification center', hint: 'notification list & read state' },
  'toolhub.games.v1': { label: 'Game scores', hint: 'high scores across the arcade' },
  /* known-but-transient keys — mapped so coverage is complete, excluded so
   * backups never carry meaningless state. */
  'nextauth.message': { label: 'NextAuth broadcast', hint: 'transient cross-tab sign-in message', exclude: true },
  'toolhub-celebrated': { label: 'Launch celebration flag', hint: 'one-time v2.0 toast marker (re-fires after restore)', exclude: true },
  'toolhub-onboarded': { label: 'Onboarding flag', hint: 'welcome-tour dismissed state (re-fires after restore)', exclude: true },
  'toolhub.share.pending': { label: 'Pending share', hint: 'in-flight share-target handoff', exclude: true },
}

/** Playback positions are written per video (`toolhub-vp:<kind>:<id>`). */
export const LS_PREFIXES: Array<{ prefix: string; label: string; hint: string }> = [
  { prefix: 'toolhub-vp:', label: 'Video playback positions', hint: 'resume points for each clip' },
]

export interface StoreMeta {
  keyPath: string
  label: string
  /** true → shown for completeness but excluded from the backup file */
  nonPortable?: boolean
}

export interface DbMeta {
  label: string
  stores: Record<string, StoreMeta>
}

/** Versioned shapes mirrored from media-db / video-db / doc-db / device-media / expense-tracker / music-player. */
export const IDB_DBS: Record<string, DbMeta> = {
  'toolhub-media': {
    label: 'Photos & images',
    stores: { photos: { keyPath: 'id', label: 'Photos' } },
  },
  'toolhub-video': {
    label: 'Video clips',
    stores: {
      clips: { keyPath: 'id', label: 'Clip details' },
      blobs: { keyPath: 'id', label: 'Video files' },
    },
  },
  'toolhub-docs': {
    label: 'Design documents',
    stores: { kv: { keyPath: 'key', label: 'Document drafts' } },
  },
  'toolhub-device': {
    label: 'Device file index',
    stores: {
      handles: { keyPath: 'key', label: 'Folder connections', nonPortable: true },
      entries: { keyPath: 'id', label: 'File index' },
      meta: { keyPath: 'key', label: 'Index metadata' },
    },
  },
  'toolhub-expenses': {
    label: 'Expense Tracker',
    stores: {
      transactions: { keyPath: 'id', label: 'Transactions' },
      settings: { keyPath: 'key', label: 'Budget & settings' },
    },
  },
  'toolhub-audio': {
    label: 'Music library',
    stores: {
      tracks: { keyPath: 'id', label: 'Tracks' },
      playlists: { keyPath: 'id', label: 'Playlists' },
    },
  },
  /* ---- Phase 1 ---- */
  'toolhub-flashcards': {
    label: 'Flashcards',
    stores: { decks: { keyPath: 'id', label: 'Decks & cards' } },
  },
  'toolhub-habits': {
    label: 'Habit Tracker',
    stores: { habits: { keyPath: 'id', label: 'Habits & check-ins' } },
  },
  'toolhub-qr': {
    label: 'QR history',
    stores: { history: { keyPath: 'id', label: 'Generated codes' } },
  },
  /* ---- Phase 2 ---- */
  'toolhub-decks': {
    label: 'Presentation Studio',
    stores: { decks: { keyPath: 'id', label: 'Presentations' } },
  },
  'toolhub-resumes': {
    label: 'Resume Builder',
    stores: { resumes: { keyPath: 'id', label: 'Resumes' } },
  },
  'toolhub-invoices': {
    label: 'Invoice Generator',
    stores: { invoices: { keyPath: 'id', label: 'Invoices' } },
  },
  'toolhub-markdown': {
    label: 'Markdown Studio',
    stores: { docs: { keyPath: 'id', label: 'Documents' } },
  },
  'toolhub-snippets': {
    label: 'Code Editor',
    stores: { snippets: { keyPath: 'id', label: 'Snippets' } },
  },
  'toolhub-taskboard': {
    label: 'Task Board',
    stores: { boards: { keyPath: 'id', label: 'Boards' } },
  },
  'toolhub-businesscard': {
    label: 'Business Card Maker',
    stores: { cards: { keyPath: 'id', label: 'Cards' } },
  },
  /* ---- Phase 3 ---- */
  'toolhub-screenrec': {
    label: 'Screen Recorder',
    stores: { recordings: { keyPath: 'id', label: 'Recording history' } },
  },
  'toolhub-gifmaker': {
    label: 'GIF Maker',
    stores: { history: { keyPath: 'id', label: 'GIF history' } },
  },
  'toolhub-videoconv': {
    label: 'Video Converter',
    stores: { history: { keyPath: 'id', label: 'Conversion history' } },
  },
  'toolhub-memes': {
    label: 'Meme Maker',
    stores: { memes: { keyPath: 'id', label: 'Saved memes' } },
  },
  'toolhub-collage': {
    label: 'Collage Maker',
    stores: { collages: { keyPath: 'id', label: 'Collages' } },
  },
  'toolhub-stickers': {
    label: 'Sticker Studio',
    stores: { stickers: { keyPath: 'id', label: 'Stickers' } },
  },
  'toolhub-subtitles': {
    label: 'Subtitle Studio',
    stores: { projects: { keyPath: 'id', label: 'Projects' } },
  },
  'toolhub-fontplay': {
    label: 'Font Playground',
    stores: { cards: { keyPath: 'id', label: 'Quote cards' } },
  },
  'toolhub-voice-recorder': {
    label: 'Voice Recorder',
    stores: { recordings: { keyPath: 'id', label: 'Recordings' } },
  },
  /* ---- Phase 4 ---- */
  'toolhub-weather': {
    label: 'Weather',
    stores: {
      locations: { keyPath: 'id', label: 'Saved locations' },
      cache: { keyPath: 'locationId', label: 'Forecast cache' },
      settings: { keyPath: 'key', label: 'Settings' },
    },
  },
  'toolhub-prayer': {
    label: 'Prayer Times',
    stores: {
      settings: { keyPath: 'key', label: 'Location & method' },
      cache: { keyPath: 'date', label: 'Timings cache' },
    },
  },
  'toolhub-health': {
    label: 'Health Tracker',
    stores: {
      metrics: { keyPath: 'key', label: 'Body profile' },
      water: { keyPath: 'date', label: 'Water intake' },
      weights: { keyPath: 'id', label: 'Weight log' },
    },
  },
  'toolhub-workouts': {
    label: 'Workout Planner',
    stores: {
      routines: { keyPath: 'id', label: 'Routines' },
      history: { keyPath: 'id', label: 'Workout history' },
      settings: { keyPath: 'key', label: 'Settings' },
    },
  },
  'toolhub-recipes': {
    label: 'Recipe Box',
    stores: {
      recipes: { keyPath: 'id', label: 'Recipes' },
      planner: { keyPath: 'slot', label: 'Meal planner' },
      settings: { keyPath: 'key', label: 'Settings' },
    },
  },
  'toolhub-shopping': {
    label: 'Shopping List',
    stores: {
      lists: { keyPath: 'id', label: 'Lists' },
      items: { keyPath: 'id', label: 'Items' },
    },
  },
  'toolhub-cycle': {
    label: 'Cycle Tracker',
    stores: {
      periods: { keyPath: 'id', label: 'Period log' },
      notes: { keyPath: 'date', label: 'Daily notes' },
      settings: { keyPath: 'key', label: 'Settings' },
    },
  },
  'toolhub-travel': {
    label: 'Travel & Fuel',
    stores: {
      settings: { keyPath: 'key', label: 'Settings' },
      fillups: { keyPath: 'id', label: 'Fill-ups' },
      trips: { keyPath: 'id', label: 'Trips' },
    },
  },
  'toolhub-currency': {
    label: 'Currency Converter',
    stores: {
      cache: { keyPath: 'key', label: 'Rate cache' },
      settings: { keyPath: 'key', label: 'Favorites & pair' },
    },
  },
  'toolhub-aichat': {
    label: 'AI Assistant',
    stores: { conversations: { keyPath: 'id', label: 'Conversations' } },
  },
  'toolhub-aiwriter': {
    label: 'AI Writer',
    stores: { docs: { keyPath: 'id', label: 'Saved drafts' } },
  },
}

