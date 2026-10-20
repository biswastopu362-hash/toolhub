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
    gradient: 'from-emerald-500 to-teal-600',
    keywords: ['math', 'calc', 'scientific', 'percent', 'log', 'trig', 'numbers'],
    Component: CalculatorTool,
  },
  {
    id: 'unit-converter',
    name: 'Unit Converter',
    description: 'Length, weight, temperature, area and 10+ unit categories',
    category: 'converter',
    icon: ArrowLeftRight,
    gradient: 'from-amber-500 to-orange-600',
    keywords: ['length', 'weight', 'temperature', 'measure', 'km', 'kg', 'celsius', 'feet', 'inches'],
    Component: UnitConverterTool,
  },
  {
    id: 'qr-generator',
    name: 'QR Studio',
    description: 'Create and download QR codes for links, text and Wi-Fi',
    category: 'generator',
    icon: QrCode,
    gradient: 'from-violet-500 to-purple-600',
    keywords: ['qr', 'barcode', 'wifi', 'scan', 'code', 'link'],
    Component: QrGeneratorTool,
  },
  {
    id: 'password-generator',
    name: 'Password Generator',
    description: 'Generate strong, secure passwords in one tap',
    category: 'generator',
    icon: KeyRound,
    gradient: 'from-pink-500 to-rose-600',
    keywords: ['password', 'security', 'random', 'strong', 'safe'],
    Component: PasswordGeneratorTool,
  },
  {
    id: 'emi-calculator',
    name: 'Loan Calculator',
    description: 'EMI, interest and total repayment with yearly breakdown',
    category: 'calculator',
    icon: Banknote,
    gradient: 'from-teal-500 to-emerald-700',
    keywords: ['emi', 'loan', 'bank', 'interest', 'mortgage', 'installment'],
    Component: EmiCalculatorTool,
  },
  {
    id: 'age-calculator',
    name: 'Age Calculator',
    description: 'Exact age from your birthday plus next-birthday countdown',
    category: 'calculator',
    icon: Cake,
    gradient: 'from-orange-500 to-red-500',
    keywords: ['age', 'birthday', 'date', 'dob', 'years'],
    Component: AgeCalculatorTool,
  },
  {
    id: 'text-tools',
    name: 'Text Toolkit',
    description: 'Case converter, word counter, duplicate remover and more',
    category: 'text',
    icon: Type,
    gradient: 'from-rose-500 to-pink-600',
    keywords: ['text', 'case', 'word', 'count', 'uppercase', 'lowercase', 'sort'],
    Component: TextToolsTool,
  },
  {
    id: 'color-tool',
    name: 'Color Studio',
    description: 'HEX, RGB, HSL, CMYK converter with shades and palettes',
    category: 'developer',
    icon: Palette,
    gradient: 'from-purple-500 to-fuchsia-600',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'cmyk', 'palette', 'shade'],
    Component: ColorToolTool,
  },
  {
    id: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Format, minify and validate JSON with error locations',
    category: 'developer',
    icon: Braces,
    gradient: 'from-lime-500 to-green-700',
    keywords: ['json', 'format', 'dev', 'api', 'validate', 'beautify'],
    Component: JsonFormatterTool,
  },
  {
    id: 'base64-tool',
    name: 'Encoder / Decoder',
    description: 'Encode and decode Base64 and URL-safe text',
    category: 'developer',
    icon: Binary,
    gradient: 'from-yellow-500 to-amber-700',
    keywords: ['base64', 'encode', 'decode', 'url', 'encoder'],
    Component: Base64ToolTool,
  },
  {
    id: 'clock',
    name: 'Clock',
    description: 'World clock, stopwatch and countdown timer',
    category: 'daily',
    icon: Clock,
    gradient: 'from-slate-600 to-slate-900',
    keywords: ['time', 'world clock', 'stopwatch', 'timer', 'alarm', 'timezone', 'countdown'],
    Component: ClockTool,
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Live forecast for any city with 7-day outlook',
    category: 'daily',
    icon: CloudSun,
    gradient: 'from-cyan-400 to-sky-600',
    keywords: ['weather', 'forecast', 'temperature', 'rain', 'city', 'climate'],
    Component: WeatherTool,
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'Write, edit and organize notes — saved on your device',
    category: 'daily',
    icon: StickyNote,
    gradient: 'from-amber-400 to-yellow-600',
    keywords: ['notes', 'write', 'memo', 'diary', 'notepad', 'text'],
    Component: NotesTool,
  },
  {
    id: 'reminders',
    name: 'Reminders',
    description: 'Simple to-do list with progress and filters',
    category: 'daily',
    icon: ListChecks,
    gradient: 'from-rose-400 to-red-500',
    keywords: ['todo', 'task', 'reminder', 'checklist', 'list', 'done'],
    Component: RemindersTool,
  },
  {
    id: 'currency',
    name: 'Currency Converter',
    description: 'Convert between 30+ world currencies with live rates',
    category: 'converter',
    icon: CircleDollarSign,
    gradient: 'from-emerald-400 to-green-600',
    keywords: ['currency', 'money', 'exchange', 'usd', 'eur', 'forex', 'rate'],
    Component: CurrencyTool,
  },
  {
    id: 'image-tools',
    name: 'Image Tools',
    description: 'Compress, resize and convert images right on your device',
    category: 'media',
    icon: ImageIcon,
    gradient: 'from-fuchsia-500 to-pink-600',
    keywords: ['image', 'photo', 'compress', 'resize', 'convert', 'webp', 'jpeg', 'png'],
    Component: ImageToolsTool,
  },
  {
    id: 'voice-recorder',
    name: 'Voice Recorder',
    description: 'Record voice memos with pause, resume and download',
    category: 'media',
    icon: Mic,
    gradient: 'from-red-500 to-rose-700',
    keywords: ['voice', 'recorder', 'audio', 'microphone', 'memo', 'record'],
    Component: VoiceRecorderTool,
  },
  {
    id: 'device-info',
    name: 'Device Info',
    description: 'Screen, battery, network, CPU and GPU details',
    category: 'utilities',
    icon: Smartphone,
    gradient: 'from-slate-500 to-gray-700',
    keywords: ['device', 'hardware', 'battery', 'screen', 'gpu', 'cpu', 'network', 'specs'],
    Component: DeviceInfoTool,
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Theme, wallpaper, installation and app data',
    category: 'utilities',
    icon: SettingsIcon,
    gradient: 'from-gray-400 to-gray-600',
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
