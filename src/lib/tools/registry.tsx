'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import {
  ArrowLeftRight,
  AudioLines,
  AudioWaveform,
  Banknote,
  Binary,
  Bot,
  Braces,
  Briefcase,
  Brush,
  Calculator,
  CalendarDays,
  Cake,
  Camera,
  CirclePlay,
  CircleDollarSign,
  Clapperboard,
  Clock,
  Compass,
  DatabaseBackup,
  FileStack,
  FileText,
  Flame,
  Layers,
  NotebookPen,
  Presentation,
  Receipt,
  Table2,
  CloudSun,
  Gamepad2,
  Grid2x2,
  FolderOpen,
  Fingerprint,
  GitCompare,
  Image as ImageIcon,
  Images,
  KeyRound,
  CalendarClock,
  Code2,
  IdCard,
  Regex,
  SquareKanban,
  Languages,
  ListChecks,
  Mic,
  Music,
  Palette,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Shapes,
  StickyNote,
  Store as StoreIcon,
  Sun,
  Target,
  Type,
  Volume2,
  Wallet,
  Settings as SettingsIcon,
} from 'lucide-react'
import { ToolSkeleton } from '@/components/tools/tool-skeleton'
import { getExternalToolById, getExternalTools } from './external'
import type { Tool, ToolCategoryMeta, ToolCategoryId } from './types'

/* ------------------------------------------------------------------ */
/* Categories (used by App Library folders)                            */
/* ------------------------------------------------------------------ */

export const toolCategories: ToolCategoryMeta[] = [
  { id: 'calculator', name: 'Calculators', icon: Calculator },
  { id: 'converter', name: 'Converters', icon: ArrowLeftRight },
  { id: 'generator', name: 'Generators', icon: Sparkles },
  { id: 'text', name: 'Text', icon: Type },
  { id: 'developer', name: 'Developer', icon: Braces },
  { id: 'productivity', name: 'Office', icon: Briefcase },
  { id: 'media', name: 'Media', icon: ImageIcon },
  { id: 'daily', name: 'Everyday', icon: Sun },
  { id: 'games', name: 'Games', icon: Gamepad2 },
  { id: 'utilities', name: 'Utilities', icon: SettingsIcon },
]

/* ------------------------------------------------------------------ */
/* Lazy app components (code-split per app)                            */
/* ------------------------------------------------------------------ */

const load = (factory: () => Promise<{ default: ComponentType }>) =>
  dynamic(factory, {
    ssr: false,
    loading: () => <ToolSkeleton />,
  })

const CalculatorTool = load(() => import('@/components/tools/calculator'))
const UnitConverterTool = load(() => import('@/components/tools/unit-converter'))
const QrGeneratorTool = load(() => import('@/components/tools/qr-generator'))
const PasswordGeneratorTool = load(() => import('@/components/tools/password-generator'))
const AgeCalculatorTool = load(() => import('@/components/tools/age-calculator'))
const EmiCalculatorTool = load(() => import('@/components/tools/emi-calculator'))
const TextToolsTool = load(() => import('@/components/tools/text-tools'))
const ColorToolTool = load(() => import('@/components/tools/color-tool'))
const JsonFormatterTool = load(() => import('@/components/tools/json-formatter'))
const DiffCheckerApp = load(() => import('@/components/tools/diff-checker'))
const RegexTesterApp = load(() => import('@/components/tools/regex-tester'))
const HashUuidApp = load(() => import('@/components/tools/hash-uuid'))
const JwtDecoderApp = load(() => import('@/components/tools/jwt-decoder'))
const CronTimestampApp = load(() => import('@/components/tools/cron-timestamp'))
const CodeEditorApp = load(() => import('@/components/tools/code-editor'))
const TaskBoardApp = load(() => import('@/components/tools/task-board'))
const BusinessCardApp = load(() => import('@/components/tools/business-card'))
const Base64ToolTool = load(() => import('@/components/tools/base64-tool'))
const ClockTool = load(() => import('@/components/tools/clock'))
const WeatherTool = load(() => import('@/components/tools/weather'))
const NotesTool = load(() => import('@/components/tools/notes'))
const RemindersTool = load(() => import('@/components/tools/reminders'))
const CurrencyTool = load(() => import('@/components/tools/currency'))
const ImageToolsTool = load(() => import('@/components/tools/image-tools'))
const VoiceRecorderTool = load(() => import('@/components/tools/voice-recorder'))
const DeviceInfoTool = load(() => import('@/components/tools/device-info'))
const SettingsTool = load(() => import('@/components/tools/settings'))
const AppStoreApp = load(() => import('@/components/os/app-store'))
const FilesApp = load(() => import('@/components/tools/files'))
const GalleryApp = load(() => import('@/components/tools/gallery'))
const CameraApp = load(() => import('@/components/tools/camera'))
const VideoStudioApp = load(() => import('@/components/tools/video-studio'))
const VideoPlayerApp = load(() => import('@/components/tools/video-player'))
const GoalTrackerApp = load(() => import('@/components/tools/goal-tracker'))
const ExpenseTrackerApp = load(() => import('@/components/tools/expense-tracker'))
const MusicPlayerApp = load(() => import('@/components/tools/music-player'))
const PaintStudioApp = load(() => import('@/components/tools/paint-studio'))
const CanvaApp = load(() => import('@/components/tools/canva'))
const SheetStudioApp = load(() => import('@/components/tools/sheet-studio'))
const PdfToolsApp = load(() => import('@/components/tools/pdf-tools'))
const CalendarApp = load(() => import('@/components/tools/calendar'))
const AiChatApp = load(() => import('@/components/tools/ai-chat'))
const Game2048App = load(() => import('@/components/tools/game-2048'))
const AdminConsoleApp = load(() => import('@/components/tools/admin-console'))
const TranslatorApp = load(() => import('@/components/tools/translator'))
const TtsStudioApp = load(() => import('@/components/tools/tts-studio'))
const SpeechToTextApp = load(() => import('@/components/tools/speech-to-text'))
const AudioStudioApp = load(() => import('@/components/tools/audio-studio'))
const BackupRestoreApp = load(() => import('@/components/tools/backup-restore'))
const FlashcardsApp = load(() => import('@/components/tools/flashcards'))
const HabitTrackerApp = load(() => import('@/components/tools/habit-tracker'))
const CompassApp = load(() => import('@/components/tools/compass'))
const MetronomeApp = load(() => import('@/components/tools/metronome'))
const PresentationStudioApp = load(() => import('@/components/tools/presentation-studio'))
const ResumeBuilderApp = load(() => import('@/components/tools/resume-builder'))
const InvoiceGeneratorApp = load(() => import('@/components/tools/invoice-generator'))
const MarkdownStudioApp = load(() => import('@/components/tools/markdown-studio'))

/* ------------------------------------------------------------------ */
/* App registry — to add a new app: one entry here + one component file */
/* ------------------------------------------------------------------ */

export const tools: Tool[] = [
  {
    id: 'files',
    name: 'Files',
    description: 'Browse every file on this device — photos, videos, music, documents. No uploading.',
    tagline: 'Your whole device, one file manager',
    category: 'utilities',
    icon: FolderOpen,
    gradient: 'from-lime-400 via-green-500 to-emerald-600',
    glow: '#22c55e',
    keywords: ['files', 'file manager', 'explorer', 'device', 'storage', 'folder', 'browse', 'documents'],
    featured: true,
    system: true,
    version: '1.0.0',
    Component: FilesApp,
  },
  {
    id: 'store',
    name: 'App Store',
    description: 'Discover, install and manage apps for every need',
    tagline: 'Everything your device needs, one tap away',
    category: 'utilities',
    icon: StoreIcon,
    gradient: 'from-emerald-400 via-teal-500 to-cyan-600',
    glow: '#10b981',
    keywords: ['store', 'apps', 'install', 'uninstall', 'discover', 'market', 'get', 'download'],
    featured: true,
    system: true,
    version: '3.0.0',
    Component: AppStoreApp,
  },
  {
    id: 'gallery',
    name: 'Gallery',
    description: 'Your photos, beautifully organized in albums',
    tagline: 'Every moment, one gallery',
    category: 'media',
    icon: Images,
    gradient: 'from-pink-400 via-fuchsia-500 to-purple-600',
    glow: '#d946ef',
    keywords: ['photos', 'images', 'gallery', 'albums', 'pictures', 'viewer', 'media'],
    featured: true,
    version: '1.4.0',
    Component: GalleryApp,
  },
  {
    id: 'camera',
    name: 'Camera',
    description: 'Take photos with live filters, timer and selfie mode',
    tagline: 'Snap stunning photos instantly',
    category: 'media',
    icon: Camera,
    gradient: 'from-slate-500 via-zinc-700 to-zinc-900',
    glow: '#71717a',
    keywords: ['camera', 'photo', 'selfie', 'webcam', 'capture', 'filters', 'shoot'],
    featured: true,
    version: '1.4.0',
    Component: CameraApp,
  },
  {
    id: 'video-studio',
    name: 'Video Studio',
    description: 'Trim, filter and enhance videos — then send them anywhere with a QR code',
    tagline: 'Edit locally, share with a scan',
    category: 'media',
    icon: Clapperboard,
    gradient: 'from-rose-400 via-red-500 to-orange-600',
    glow: '#ef4444',
    keywords: ['video', 'editor', 'trim', 'cut', 'filters', 'movie', 'clip', 'editing', 'qr', 'transfer', 'share'],
    featured: true,
    version: '2.0.0',
    Component: VideoStudioApp,
  },
  {
    id: 'video-player',
    name: 'Video Player',
    description: 'Import videos from any phone or computer and watch with cinema-grade playback',
    tagline: 'Your screen, your cinema',
    category: 'media',
    icon: CirclePlay,
    gradient: 'from-fuchsia-500 via-violet-600 to-purple-800',
    glow: '#c026d3',
    keywords: ['video', 'player', 'watch', 'movies', 'clips', 'cinema', 'playback', 'resume', 'device', 'import'],
    featured: true,
    version: '1.1.0',
    Component: VideoPlayerApp,
  },
  {
    id: 'music-player',
    name: 'Music Player',
    description: 'Play your tracks with playlists and a live visualizer',
    tagline: 'Your sound, your way',
    category: 'media',
    icon: Music,
    gradient: 'from-emerald-300 via-teal-500 to-cyan-600',
    glow: '#14b8a6',
    keywords: ['music', 'audio', 'player', 'songs', 'playlist', 'visualizer', 'sound'],
    version: '1.2.0',
    Component: MusicPlayerApp,
  },
  {
    id: 'paint-studio',
    name: 'Paint Studio',
    description: 'Draw, sketch and doodle with brushes and colors',
    tagline: 'A canvas for your imagination',
    category: 'media',
    icon: Brush,
    gradient: 'from-violet-400 via-purple-500 to-fuchsia-600',
    glow: '#a855f7',
    keywords: ['paint', 'draw', 'sketch', 'doodle', 'canvas', 'art', 'brush', 'design'],
    version: '1.0.0',
    Component: PaintStudioApp,
  },
  {
    id: 'design-studio',
    name: 'Design Studio',
    description: 'Design posters AND edit real documents — draw, highlight, sign, fix text, white-out, add images, export PDF',
    tagline: 'Design anything, edit every file',
    category: 'media',
    icon: Shapes,
    gradient: 'from-purple-500 via-fuchsia-500 to-pink-500',
    glow: '#d946ef',
    keywords: ['canva', 'design', 'graphic', 'poster', 'thumbnail', 'template', 'banner', 'logo', 'instagram', 'story', 'text', 'sticker', 'pdf', 'word', 'docx', 'document', 'editor', 'whiteout', 'signature', 'a4', 'letter', 'resume', 'draw', 'pen', 'highlighter', 'marker', 'annotate', 'arrow', 'ink'],
    featured: true,
    version: '2.1.0',
    Component: CanvaApp,
  },
  {
    id: 'sheet-studio',
    name: 'Sheet Studio',
    description: 'Edit Excel, CSV and ODS spreadsheets on-device — tabs, formulas, undo, XLSX/CSV export',
    tagline: 'Excel power, zero upload',
    category: 'productivity',
    icon: Table2,
    gradient: 'from-emerald-400 via-teal-500 to-green-600',
    glow: '#10b981',
    keywords: ['excel', 'xlsx', 'xls', 'csv', 'ods', 'spreadsheet', 'sheet', 'cells', 'formula', 'sum', 'table', 'workbook', 'editor', 'budget'],
    featured: true,
    version: '1.0.0',
    Component: SheetStudioApp,
  },
  {
    id: 'pdf-tools',
    name: 'PDF Tools',
    description: 'Merge, split, rotate and extract PDF pages — lossless, private, right on your device',
    tagline: 'Acrobat-class PDF pages, no uploads',
    category: 'productivity',
    icon: FileStack,
    gradient: 'from-rose-500 via-red-500 to-orange-600',
    glow: '#f43f5e',
    keywords: ['pdf', 'merge', 'split', 'extract', 'rotate', 'pages', 'trim', 'combine', 'organize', 'document', 'offline'],
    featured: true,
    version: '1.0.0',
    Component: PdfToolsApp,
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Plan months ahead with events, colors and reminders',
    tagline: 'Your days, beautifully planned',
    category: 'daily',
    icon: CalendarDays,
    gradient: 'from-red-400 via-rose-500 to-pink-600',
    glow: '#f43f5e',
    keywords: ['calendar', 'events', 'schedule', 'plan', 'month', 'date', 'agenda'],
    version: '1.0.0',
    Component: CalendarApp,
  },
  {
    id: 'goal-tracker',
    name: 'Goal Tracker',
    description: 'Build streaks that stick — daily goals, rings, flames and heatmaps',
    tagline: 'Small wins, every single day',
    category: 'daily',
    icon: Target,
    gradient: 'from-teal-300 via-emerald-500 to-green-600',
    glow: '#2dd4bf',
    keywords: ['goal', 'tracker', 'habit', 'streak', 'routine', 'target', 'productivity', 'daily', 'heatmap'],
    featured: true,
    version: '1.0.0',
    Component: GoalTrackerApp,
  },
  {
    id: 'expense-tracker',
    name: 'Expense Tracker',
    description: 'Track income and spending by category with monthly budgets, budget alerts and live charts',
    tagline: 'Know where your money goes',
    category: 'daily',
    icon: Wallet,
    gradient: 'from-green-300 via-emerald-500 to-teal-600',
    glow: '#10b981',
    keywords: ['expense', 'income', 'money', 'budget', 'finance', 'spending', 'track', 'wallet', 'cost', 'savings', 'taka', 'salary'],
    featured: true,
    version: '1.0.0',
    Component: ExpenseTrackerApp,
  },
  {
    id: 'translator',
    name: 'Translator',
    description: 'AI translation between 25+ languages with swap, copy, share and history',
    tagline: 'Every language, one tap away',
    category: 'text',
    icon: Languages,
    gradient: 'from-violet-400 via-purple-500 to-fuchsia-600',
    glow: '#a855f7',
    keywords: ['translate', 'translator', 'language', 'bengali', 'english', 'arabic', 'hindi', 'interpret', 'meaning'],
    featured: true,
    version: '1.0.0',
    Component: TranslatorApp,
  },
  {
    id: 'tts-studio',
    name: 'TTS Studio',
    description: 'Turn text into natural speech — voices, speed control, play and download as WAV',
    tagline: 'Type it, hear it',
    category: 'text',
    icon: Volume2,
    gradient: 'from-yellow-300 via-orange-400 to-red-500',
    glow: '#f97316',
    keywords: ['tts', 'text to speech', 'speech', 'voice', 'audio', 'read aloud', 'narrate', 'speak'],
    version: '1.0.0',
    Component: TtsStudioApp,
  },
  {
    id: 'speech-to-text',
    name: 'Speech to Text',
    description: 'Live mic transcription with history — hands-free voice notes you can save into Notes',
    tagline: 'Speak, see it written',
    category: 'text',
    icon: AudioLines,
    gradient: 'from-teal-300 via-teal-500 to-emerald-600',
    glow: '#14b8a6',
    keywords: ['speech to text', 'voice notes', 'dictation', 'transcribe', 'microphone', 'asr', 'stt'],
    version: '1.0.0',
    Component: SpeechToTextApp,
  },
  {
    id: 'audio-studio',
    name: 'Audio Studio',
    description: 'Trim, merge and convert audio with a live waveform — export WAV or WebM',
    tagline: 'Your pocket audio lab',
    category: 'media',
    icon: AudioWaveform,
    gradient: 'from-pink-400 via-rose-500 to-red-600',
    glow: '#f43f5e',
    keywords: ['audio', 'trim', 'merge', 'convert', 'waveform', 'cut', 'mp3', 'wav', 'editor'],
    version: '1.0.0',
    Component: AudioStudioApp,
  },
  {
    id: 'backup-restore',
    name: 'Backup & Restore',
    description: 'Export every app\u2019s data to one JSON file and restore it on any device — files never leave your device',
    tagline: 'Your OS, portable',
    category: 'utilities',
    icon: DatabaseBackup,
    gradient: 'from-zinc-400 via-slate-500 to-slate-700',
    glow: '#64748b',
    keywords: ['backup', 'restore', 'export', 'import', 'migrate', 'json', 'transfer device', 'copy data'],
    version: '1.0.0',
    Component: BackupRestoreApp,
  },
  {
    id: 'ai-chat',
    name: 'AI Assistant',
    description: 'Ask anything — write, translate, summarize and brainstorm',
    tagline: 'A smart friend, always ready',
    category: 'utilities',
    icon: Bot,
    gradient: 'from-amber-300 via-orange-500 to-rose-500',
    glow: '#f59e0b',
    keywords: ['ai', 'chat', 'assistant', 'gpt', 'writer', 'translate', 'summarize', 'bot'],
    featured: true,
    version: '1.3.0',
    Component: AiChatApp,
  },
  {
    id: 'game-2048',
    name: '2048',
    description: 'The classic tile puzzle — swipe, merge, beat your best',
    tagline: 'Simple to learn, hard to master',
    category: 'games',
    icon: Grid2x2,
    gradient: 'from-orange-300 via-amber-500 to-yellow-600',
    glow: '#f59e0b',
    keywords: ['2048', 'game', 'puzzle', 'tiles', 'merge', 'numbers', 'swipe'],
    version: '1.0.0',
    Component: Game2048App,
  },
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Scientific calculator with history, logs, powers and trig',
    category: 'calculator',
    icon: Calculator,
    gradient: 'from-emerald-400 via-emerald-500 to-teal-600',
    glow: '#10b981',
    keywords: ['math', 'calc', 'scientific', 'percent', 'log', 'trig', 'numbers'],
    Component: CalculatorTool,
  },
  {
    id: 'unit-converter',
    name: 'Unit Converter',
    description: 'Length, weight, temperature, area and 10+ unit categories',
    category: 'converter',
    icon: ArrowLeftRight,
    gradient: 'from-amber-400 via-amber-500 to-orange-600',
    glow: '#f59e0b',
    keywords: ['length', 'weight', 'temperature', 'measure', 'km', 'kg', 'celsius', 'feet', 'inches'],
    Component: UnitConverterTool,
  },
  {
    id: 'qr-generator',
    name: 'QR Studio',
    description: 'Create QR codes for links, Wi-Fi, contacts and bulk CSV rows — with a reusable history',
    tagline: 'Every kind of QR, beautifully',
    category: 'generator',
    icon: QrCode,
    gradient: 'from-violet-400 via-violet-500 to-purple-600',
    glow: '#8b5cf6',
    keywords: ['qr', 'barcode', 'wifi', 'vcard', 'contact', 'csv', 'bulk', 'scan', 'history', 'code'],
    version: '2.0.0',
    Component: QrGeneratorTool,
  },
  {
    id: 'password-generator',
    name: 'Password Generator',
    description: 'Generate strong, secure passwords in one tap',
    category: 'generator',
    icon: KeyRound,
    gradient: 'from-pink-400 via-pink-500 to-rose-600',
    glow: '#ec4899',
    keywords: ['password', 'security', 'random', 'strong', 'safe'],
    Component: PasswordGeneratorTool,
  },
  {
    id: 'emi-calculator',
    name: 'Loan Calculator',
    description: 'EMI, interest and total repayment with yearly breakdown',
    category: 'calculator',
    icon: Banknote,
    gradient: 'from-teal-400 via-teal-500 to-emerald-700',
    glow: '#0d9488',
    keywords: ['emi', 'loan', 'bank', 'interest', 'mortgage', 'installment'],
    Component: EmiCalculatorTool,
  },
  {
    id: 'age-calculator',
    name: 'Age Calculator',
    description: 'Exact age from your birthday plus next-birthday countdown',
    category: 'calculator',
    icon: Cake,
    gradient: 'from-orange-400 via-orange-500 to-red-500',
    glow: '#f97316',
    keywords: ['age', 'birthday', 'date', 'dob', 'years'],
    Component: AgeCalculatorTool,
  },
  {
    id: 'text-tools',
    name: 'Text Toolkit',
    description: 'Case converter, word counter, duplicate remover and more',
    category: 'text',
    icon: Type,
    gradient: 'from-rose-400 via-rose-500 to-pink-600',
    glow: '#f43f5e',
    keywords: ['text', 'case', 'word', 'count', 'uppercase', 'lowercase', 'sort'],
    Component: TextToolsTool,
  },
  {
    id: 'color-tool',
    name: 'Color Studio',
    description: 'HEX, RGB, HSL, CMYK converter with shades and palettes',
    category: 'developer',
    icon: Palette,
    gradient: 'from-purple-400 via-purple-500 to-fuchsia-600',
    glow: '#a855f7',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'cmyk', 'palette', 'shade'],
    Component: ColorToolTool,
  },
  {
    id: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Format, minify and validate JSON with error locations',
    category: 'developer',
    icon: Braces,
    gradient: 'from-lime-400 via-lime-500 to-green-700',
    glow: '#65a30d',
    keywords: ['json', 'format', 'dev', 'api', 'validate', 'beautify'],
    Component: JsonFormatterTool,
  },
  {
    id: 'diff-checker',
    name: 'Diff Checker',
    description: 'Compare two texts line by line — side-by-side or unified, word-level highlights, copy a patch',
    tagline: 'See every change at a glance',
    category: 'developer',
    icon: GitCompare,
    gradient: 'from-sky-400 via-cyan-500 to-teal-600',
    glow: '#06b6d4',
    keywords: ['diff', 'compare', 'changes', 'patch', 'merge', 'dev', 'text'],
    version: '1.0.0',
    Component: DiffCheckerApp,
  },
  {
    id: 'regex-tester',
    name: 'Regex Tester',
    description: 'Test regular expressions live — match table, capture groups, replace preview and a cheat sheet',
    tagline: 'Master regular expressions',
    category: 'developer',
    icon: Regex,
    gradient: 'from-rose-400 via-pink-500 to-fuchsia-600',
    glow: '#ec4899',
    keywords: ['regex', 'regexp', 'pattern', 'match', 'replace', 'dev', 'test'],
    featured: true,
    version: '1.0.0',
    Component: RegexTesterApp,
  },
  {
    id: 'hash-uuid',
    name: 'Hash & UUID',
    description: 'SHA/MD5 hashes of text or files and bulk UUID v4 generation — all on-device',
    tagline: 'Hashes and IDs, instantly',
    category: 'developer',
    icon: Fingerprint,
    gradient: 'from-emerald-400 via-green-500 to-teal-600',
    glow: '#10b981',
    keywords: ['hash', 'sha256', 'sha512', 'md5', 'checksum', 'uuid', 'guid', 'id', 'dev'],
    version: '1.0.0',
    Component: HashUuidApp,
  },
  {
    id: 'jwt-decoder',
    name: 'JWT Decoder',
    description: 'Decode JWT header and payload, inspect claims and expiry — 100% locally, never verified or uploaded',
    tagline: 'Peek inside any token, privately',
    category: 'developer',
    icon: KeyRound,
    gradient: 'from-violet-400 via-purple-500 to-fuchsia-600',
    glow: '#a855f7',
    keywords: ['jwt', 'token', 'auth', 'decode', 'claims', 'expiry', 'dev', 'api'],
    version: '1.0.0',
    Component: JwtDecoderApp,
  },
  {
    id: 'cron-timestamp',
    name: 'Cron & Timestamp',
    description: 'Parse cron expressions into plain English with next-run times, and convert epoch ⇄ dates',
    tagline: 'Cron schedules, human readable',
    category: 'developer',
    icon: CalendarClock,
    gradient: 'from-teal-300 via-teal-500 to-emerald-600',
    glow: '#14b8a6',
    keywords: ['cron', 'schedule', 'timestamp', 'epoch', 'unix', 'date', 'convert', 'dev'],
    version: '1.0.0',
    Component: CronTimestampApp,
  },
  {
    id: 'code-editor',
    name: 'Code Editor',
    description: 'Syntax-highlighted mini editor with a snippet library — 8 languages, download and share files',
    tagline: 'Code anywhere, snippets synced',
    category: 'developer',
    icon: Code2,
    gradient: 'from-amber-300 via-amber-500 to-orange-600',
    glow: '#f59e0b',
    keywords: ['code', 'editor', 'snippet', 'syntax', 'javascript', 'python', 'sql', 'dev', 'ide'],
    version: '1.0.0',
    Component: CodeEditorApp,
  },
  {
    id: 'task-board',
    name: 'Task Board',
    description: 'Kanban boards with drag & drop columns, due dates and priorities — your projects, visual',
    tagline: 'Drag your work to done',
    category: 'daily',
    icon: SquareKanban,
    gradient: 'from-orange-300 via-rose-400 to-pink-600',
    glow: '#fb923c',
    keywords: ['kanban', 'board', 'task', 'todo', 'project', 'column', 'drag', 'scrum'],
    featured: true,
    version: '1.0.0',
    Component: TaskBoardApp,
  },
  {
    id: 'business-card',
    name: 'Business Card Maker',
    description: 'Design double-sided business cards from 6 templates — export print-ready PNG and PDF',
    tagline: 'Your identity, pocket-sized',
    category: 'productivity',
    icon: IdCard,
    gradient: 'from-fuchsia-300 via-pink-400 to-rose-500',
    glow: '#d946ef',
    keywords: ['business card', 'card', 'contact', 'design', 'template', 'print', 'logo', 'vcard'],
    version: '1.0.0',
    Component: BusinessCardApp,
  },
  {
    id: 'base64-tool',
    name: 'Encoder / Decoder',
    description: 'Encode and decode Base64 and URL-safe text',
    category: 'developer',
    icon: Binary,
    gradient: 'from-yellow-400 via-yellow-500 to-amber-700',
    glow: '#d97706',
    keywords: ['base64', 'encode', 'decode', 'url', 'encoder'],
    Component: Base64ToolTool,
  },
  {
    id: 'clock',
    name: 'Clock',
    description: 'Stopwatch with laps, countdown timer with alarm and a world clock strip',
    category: 'daily',
    icon: Clock,
    gradient: 'from-slate-500 via-slate-600 to-slate-800',
    glow: '#475569',
    keywords: ['time', 'world clock', 'stopwatch', 'timer', 'alarm', 'timezone', 'countdown', 'laps'],
    version: '2.0.0',
    Component: ClockTool,
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Live forecast for any city with 7-day outlook',
    category: 'daily',
    icon: CloudSun,
    gradient: 'from-cyan-300 via-cyan-500 to-sky-600',
    glow: '#0ea5e9',
    keywords: ['weather', 'forecast', 'temperature', 'rain', 'city', 'climate'],
    Component: WeatherTool,
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'Folders, pins, colors, markdown-lite preview and .md export — your private notebook',
    tagline: 'Your notebook, upgraded',
    category: 'daily',
    icon: StickyNote,
    gradient: 'from-amber-300 via-amber-400 to-yellow-600',
    glow: '#fbbf24',
    keywords: ['notes', 'write', 'memo', 'diary', 'notepad', 'text', 'folder', 'pin', 'markdown', 'export', 'color', 'notebook'],
    version: '2.0.0',
    Component: NotesTool,
  },
  {
    id: 'reminders',
    name: 'Reminders',
    description: 'Simple to-do list with progress and filters',
    category: 'daily',
    icon: ListChecks,
    gradient: 'from-rose-300 via-rose-400 to-red-500',
    glow: '#fb7185',
    keywords: ['todo', 'task', 'reminder', 'checklist', 'list', 'done'],
    Component: RemindersTool,
  },
  {
    id: 'currency',
    name: 'Currency Converter',
    description: 'Convert between 30+ world currencies with live rates',
    category: 'converter',
    icon: CircleDollarSign,
    gradient: 'from-emerald-300 via-emerald-400 to-green-600',
    glow: '#22c55e',
    keywords: ['currency', 'money', 'exchange', 'usd', 'eur', 'forex', 'rate'],
    Component: CurrencyTool,
  },
  {
    id: 'image-tools',
    name: 'Photo Editor',
    description: 'Crop, rotate, tune brightness/contrast/saturation, filter presets and before/after compare — saves to Gallery',
    tagline: 'A pocket darkroom',
    category: 'media',
    icon: ImageIcon,
    gradient: 'from-fuchsia-400 via-fuchsia-500 to-pink-600',
    glow: '#d946ef',
    keywords: ['image', 'photo', 'editor', 'crop', 'rotate', 'filter', 'brightness', 'contrast', 'saturation', 'compress', 'resize', 'convert', 'webp', 'jpeg', 'png'],
    version: '2.0.0',
    Component: ImageToolsTool,
  },
  {
    id: 'voice-recorder',
    name: 'Voice Recorder',
    description: 'Record voice memos with pause, resume and download',
    category: 'media',
    icon: Mic,
    gradient: 'from-red-400 via-red-500 to-rose-700',
    glow: '#ef4444',
    keywords: ['voice', 'recorder', 'audio', 'microphone', 'memo', 'record'],
    Component: VoiceRecorderTool,
  },
  {
    id: 'device-info',
    name: 'Device Info',
    description: 'Screen, battery, network, CPU and GPU details',
    category: 'utilities',
    icon: Smartphone,
    gradient: 'from-slate-400 via-slate-500 to-gray-700',
    glow: '#64748b',
    keywords: ['device', 'hardware', 'battery', 'screen', 'gpu', 'cpu', 'network', 'specs'],
    Component: DeviceInfoTool,
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Theme, wallpaper, installation and app data',
    category: 'utilities',
    icon: SettingsIcon,
    gradient: 'from-gray-300 via-gray-400 to-gray-600',
    glow: '#9ca3af',
    keywords: ['settings', 'theme', 'dark mode', 'wallpaper', 'install', 'about', 'preferences'],
    system: true,
    version: '3.0.0',
    Component: SettingsTool,
  },
  {
    id: 'admin-console',
    name: 'Admin Console',
    description: 'Owner-only console to add, edit, hide and remove the linked platforms that appear in this hub',
    tagline: 'Curate the store — link your own PWAs',
    category: 'utilities',
    icon: ShieldCheck,
    gradient: 'from-slate-500 via-zinc-600 to-zinc-800',
    glow: '#64748b',
    keywords: ['admin', 'console', 'owner', 'manage', 'platforms', 'linked', 'pwa', 'add', 'remove', 'hub'],
    featured: true,
    version: '1.0.0',
    Component: AdminConsoleApp,
  },
  {
    id: 'flashcards',
    name: 'Flashcards',
    description: 'Build decks, flip cards and grade yourself with live accuracy stats — perfect for exams and language practice',
    tagline: 'Memorize anything, one flip at a time',
    category: 'daily',
    icon: Layers,
    gradient: 'from-violet-400 via-purple-500 to-fuchsia-600',
    glow: '#a855f7',
    keywords: ['flashcards', 'deck', 'study', 'memorize', 'learn', 'revision', 'exam', 'quiz', 'cards', 'flip', 'practice'],
    featured: true,
    version: '1.0.0',
    Component: FlashcardsApp,
  },
  {
    id: 'habit-tracker',
    name: 'Habit Tracker',
    description: 'Build streaks with daily check-offs, week dots, milestone toasts and a 30-day heatmap per habit',
    tagline: 'Small streaks, big change',
    category: 'daily',
    icon: Flame,
    gradient: 'from-amber-300 via-orange-400 to-orange-600',
    glow: '#f97316',
    keywords: ['habit', 'streak', 'routine', 'tracker', 'heatmap', 'daily', 'checklist', 'consistency', 'discipline'],
    featured: true,
    version: '1.0.0',
    Component: HabitTrackerApp,
  },
  {
    id: 'compass',
    name: 'Compass & Level',
    description: 'Magnetic compass with true-north readout plus a bubble level — sensor fallbacks keep it working everywhere',
    tagline: 'Find north, level up',
    category: 'utilities',
    icon: Compass,
    gradient: 'from-emerald-300 via-teal-500 to-teal-600',
    glow: '#14b8a6',
    keywords: ['compass', 'level', 'bubble', 'direction', 'north', 'heading', 'tilt', 'orientation', 'magnetic'],
    featured: true,
    version: '1.0.0',
    Component: CompassApp,
  },
  {
    id: 'metronome',
    name: 'Metronome & Tuner',
    description: 'Precision metronome with tap tempo, time signatures and beat dots, plus a live microphone pitch tuner',
    tagline: 'Keep time, find pitch',
    category: 'media',
    icon: AudioLines,
    gradient: 'from-rose-300 via-pink-500 to-fuchsia-600',
    glow: '#ec4899',
    keywords: ['metronome', 'tuner', 'bpm', 'tempo', 'beat', 'pitch', 'music', 'tap tempo', 'tuning', 'instrument'],
    featured: true,
    version: '1.0.0',
    Component: MetronomeApp,
  },
  {
    id: 'presentation-studio',
    name: 'Presentation Studio',
    description: 'Design 16:9 slides with text, shapes and images, present fullscreen and export PDF decks',
    tagline: 'Slides that sell the story',
    category: 'productivity',
    icon: Presentation,
    gradient: 'from-cyan-300 via-teal-400 to-teal-600',
    glow: '#06b6d4',
    keywords: ['presentation', 'slides', 'deck', 'powerpoint', 'presenter', 'keynote', 'export pdf', 'pitch'],
    featured: true,
    version: '1.0.0',
    Component: PresentationStudioApp,
  },
  {
    id: 'resume-builder',
    name: 'Resume Builder',
    description: 'Sectioned resume editor with three templates, live A4 preview and clean PDF export',
    tagline: 'Your story, one clean page',
    category: 'productivity',
    icon: FileText,
    gradient: 'from-slate-300 via-slate-400 to-zinc-600',
    glow: '#94a3b8',
    keywords: ['resume', 'cv', 'builder', 'job', 'career', 'template', 'a4', 'pdf', 'portfolio'],
    featured: true,
    version: '1.0.0',
    Component: ResumeBuilderApp,
  },
  {
    id: 'invoice-generator',
    name: 'Invoice Generator',
    description: 'Line items, tax and discount math, branded paper preview and a polished PDF invoice',
    tagline: 'Get paid, look sharp',
    category: 'productivity',
    icon: Receipt,
    gradient: 'from-lime-300 via-emerald-400 to-teal-600',
    glow: '#84cc16',
    keywords: ['invoice', 'billing', 'receipt', 'tax', 'vat', 'client', 'freelance', 'payment', 'business'],
    featured: true,
    version: '1.0.0',
    Component: InvoiceGeneratorApp,
  },
  {
    id: 'markdown-studio',
    name: 'Markdown Studio',
    description: 'Write markdown with a live preview, autosaved drafts and HTML/PDF exports',
    tagline: 'Write markdown, ship documents',
    category: 'text',
    icon: NotebookPen,
    gradient: 'from-purple-300 via-violet-400 to-purple-600',
    glow: '#a78bfa',
    keywords: ['markdown', 'md', 'editor', 'preview', 'docs', 'export html', 'writing', 'notes'],
    featured: true,
    version: '1.0.0',
    Component: MarkdownStudioApp,
  },
]

/* ------------------------------------------------------------------ */

/** Built-in first, then admin-linked platforms. */
export function getToolById(id: string | null): Tool | undefined {
  if (!id) return undefined
  return tools.find((t) => t.id === id) ?? getExternalToolById(id)
}

/* ------------------------------------------------------------------ */
/* Deterministic store metadata — stable per app, no manual upkeep      */
/* ------------------------------------------------------------------ */

function hashId(s: string): number {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export interface StoreStats {
  developer: string
  size: string
  rating: number
  downloads: string
  version: string
  tagline: string
}

/** Fill in any store metadata an app entry omits (stable per id). */
export function storeStats(t: Tool): StoreStats {
  const h = hashId(t.id)
  return {
    developer: t.developer ?? 'ToolHub Labs',
    size: t.size ?? `${(0.8 + (h % 96) / 10).toFixed(1)} MB`,
    rating: t.rating ?? Number((4.1 + (h % 8) / 10).toFixed(1)),
    downloads: t.downloads ?? ['10K+', '50K+', '100K+', '250K+', '500K+', '1M+', '5M+'][h % 7],
    version: t.version ?? '2.1.' + (h % 5),
    tagline: t.tagline ?? t.description,
  }
}

export function searchTools(query: string, category: ToolCategoryId | 'all'): Tool[] {
  const q = query.trim().toLowerCase()
  return [...tools, ...getExternalTools()].filter((t) => {
    if (category !== 'all' && t.category !== category) return false
    if (!q) return true
    const catName = toolCategories.find((c) => c.id === t.category)?.name.toLowerCase() ?? ''
    const haystack = [t.name, t.description, t.keywords.join(' '), catName].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

export type { Tool, ToolCategoryMeta, ToolCategoryId }
