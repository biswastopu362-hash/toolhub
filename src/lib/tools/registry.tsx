'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import {
  ArrowLeftRight,
  Banknote,
  Binary,
  Braces,
  Calculator,
  Cake,
  CircleDollarSign,
  Clock,
  CloudSun,
  Image as ImageIcon,
  KeyRound,
  ListChecks,
  Mic,
  Palette,
  QrCode,
  Smartphone,
  Sparkles,
  StickyNote,
  Sun,
  Type,
  Settings as SettingsIcon,
} from 'lucide-react'
import { ToolSkeleton } from '@/components/tools/tool-skeleton'
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
  { id: 'daily', name: 'Everyday', icon: Sun },
  { id: 'media', name: 'Media', icon: ImageIcon },
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

/* ------------------------------------------------------------------ */
/* App registry — to add a new app: one entry here + one component file */
/* ------------------------------------------------------------------ */

export const tools: Tool[] = [
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
    description: 'Create and download QR codes for links, text and Wi-Fi',
    category: 'generator',
    icon: QrCode,
    gradient: 'from-violet-400 via-violet-500 to-purple-600',
    glow: '#8b5cf6',
    keywords: ['qr', 'barcode', 'wifi', 'scan', 'code', 'link'],
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
    description: 'World clock, stopwatch and countdown timer',
    category: 'daily',
    icon: Clock,
    gradient: 'from-slate-500 via-slate-600 to-slate-800',
    glow: '#475569',
    keywords: ['time', 'world clock', 'stopwatch', 'timer', 'alarm', 'timezone', 'countdown'],
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
    description: 'Write, edit and organize notes — saved on your device',
    category: 'daily',
    icon: StickyNote,
    gradient: 'from-amber-300 via-amber-400 to-yellow-600',
    glow: '#fbbf24',
    keywords: ['notes', 'write', 'memo', 'diary', 'notepad', 'text'],
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
    name: 'Image Tools',
    description: 'Compress, resize and convert images right on your device',
    category: 'media',
    icon: ImageIcon,
    gradient: 'from-fuchsia-400 via-fuchsia-500 to-pink-600',
    glow: '#d946ef',
    keywords: ['image', 'photo', 'compress', 'resize', 'convert', 'webp', 'jpeg', 'png'],
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
    Component: SettingsTool,
  },
]

/* ------------------------------------------------------------------ */

export function getToolById(id: string | null): Tool | undefined {
  if (!id) return undefined
  return tools.find((t) => t.id === id)
}

export function searchTools(query: string, category: ToolCategoryId | 'all'): Tool[] {
  const q = query.trim().toLowerCase()
  return tools.filter((t) => {
    if (category !== 'all' && t.category !== category) return false
    if (!q) return true
    const haystack = [t.name, t.description, t.keywords.join(' '), t.category].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

export type { Tool, ToolCategoryMeta, ToolCategoryId }
