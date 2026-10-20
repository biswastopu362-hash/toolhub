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
  KeyRound,
  Palette,
  QrCode,
  Sparkles,
  Sun,
  Type,
} from 'lucide-react'
import { ToolSkeleton } from '@/components/tools/tool-skeleton'
import type { Tool, ToolCategoryMeta, ToolCategoryId } from './types'

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export const toolCategories: ToolCategoryMeta[] = [
  { id: 'calculator', nameBn: 'ক্যালকুলেটর', nameEn: 'Calculators', icon: Calculator },
  { id: 'converter', nameBn: 'কনভার্টার', nameEn: 'Converters', icon: ArrowLeftRight },
  { id: 'generator', nameBn: 'জেনারেটর', nameEn: 'Generators', icon: Sparkles },
  { id: 'text', nameBn: 'টেক্সট', nameEn: 'Text', icon: Type },
  { id: 'developer', nameBn: 'ডেভেলপার', nameEn: 'Developer', icon: Braces },
  { id: 'daily', nameBn: 'প্রতিদিনের কাজ', nameEn: 'Daily', icon: Sun },
]

/* ------------------------------------------------------------------ */
/* Lazy tool components (code-split per tool)                          */
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

/* ------------------------------------------------------------------ */
/* Tool registry — নতুন টুল যোগ করতে এখানে একটি এন্ট্রি + কম্পোনেন্ট ফাইল যোগ করুন */
/* ------------------------------------------------------------------ */

export const tools: Tool[] = [
  {
    id: 'calculator',
    nameBn: 'ক্যালকুলেটর',
    nameEn: 'Scientific Calculator',
    descBn: 'বৈজ্ঞানিক হিসাব, লগ, ঘাত, বর্গমূল — ইতিহাস সহ',
    category: 'calculator',
    icon: Calculator,
    gradient: 'from-emerald-500 to-teal-600',
    keywords: ['গণিত', 'হিসাব', 'যোগ', 'বিয়োগ', 'গুণ', 'ভাগ', 'লগ', 'math', 'calc', 'scientific', 'percent'],
    Component: CalculatorTool,
  },
  {
    id: 'unit-converter',
    nameBn: 'ইউনিট কনভার্টার',
    nameEn: 'Unit Converter',
    descBn: 'দৈর্ঘ্য, ওজন, তাপমাত্রা, কাঠা-বিঘা সহ ১০ ধরনের ইউনিট',
    category: 'converter',
    icon: ArrowLeftRight,
    gradient: 'from-amber-500 to-orange-600',
    keywords: ['দৈর্ঘ্য', 'ওজন', 'তাপমাত্রা', 'কাঠা', 'বিঘা', 'মণ', 'length', 'weight', 'temperature', 'measure', 'km', 'kg'],
    Component: UnitConverterTool,
  },
  {
    id: 'qr-generator',
    nameBn: 'কিউআর কোড',
    nameEn: 'QR Code Generator',
    descBn: 'টেক্সট, লিংক ও ওয়াইফাইয়ের QR কোড বানান ও ডাউনলোড করুন',
    category: 'generator',
    icon: QrCode,
    gradient: 'from-violet-500 to-purple-600',
    keywords: ['কিউআর', 'ওয়াইফাই', 'বারকোড', 'wifi', 'scan', 'qr', 'code'],
    Component: QrGeneratorTool,
  },
  {
    id: 'password-generator',
    nameBn: 'পাসওয়ার্ড জেনারেটর',
    nameEn: 'Password Generator',
    descBn: 'শক্তিশালী ও নিরাপদ পাসওয়ার্ড তৈরি করুন এক ক্লিকে',
    category: 'generator',
    icon: KeyRound,
    gradient: 'from-pink-500 to-rose-600',
    keywords: ['পাসওয়ার্ড', 'নিরাপদ', 'গোপন', 'security', 'password', 'random', 'strong'],
    Component: PasswordGeneratorTool,
  },
  {
    id: 'emi-calculator',
    nameBn: 'লোন / EMI ক্যালকুলেটর',
    nameEn: 'Loan EMI Calculator',
    descBn: 'কিস্তি, সুদ ও মোট পরিশোধ হিসাব করুন — ইয়ার রিপোর্ট সহ',
    category: 'calculator',
    icon: Banknote,
    gradient: 'from-teal-500 to-emerald-700',
    keywords: ['লোন', 'কিস্তি', 'সুদ', 'ঋণ', 'emi', 'loan', 'bank', 'interest', ' installment'],
    Component: EmiCalculatorTool,
  },
  {
    id: 'age-calculator',
    nameBn: 'বয়স ক্যালকুলেটর',
    nameEn: 'Age Calculator',
    descBn: 'জন্মতারিখ থেকে সঠিক বয়স ও পরবর্তী জন্মদিনের হিসাব',
    category: 'daily',
    icon: Cake,
    gradient: 'from-orange-500 to-red-500',
    keywords: ['বয়স', 'জন্মতারিখ', 'জন্মদিন', 'age', 'birthday', 'date', 'dob'],
    Component: AgeCalculatorTool,
  },
  {
    id: 'text-tools',
    nameBn: 'টেক্সট টুলস',
    nameEn: 'Text Toolkit',
    descBn: 'কেস বদল, শব্দ গণনা, ডুপ্লিকেট বাদ, সাজানো — সব এক জায়গায়',
    category: 'text',
    icon: Type,
    gradient: 'from-rose-500 to-pink-600',
    keywords: ['লেখা', 'শব্দ', 'বর্ণ', 'কপি', 'text', 'case', 'word', 'count', 'uppercase'],
    Component: TextToolsTool,
  },
  {
    id: 'color-tool',
    nameBn: 'কালার টুল',
    nameEn: 'Color Picker & Converter',
    descBn: 'HEX, RGB, HSL, CMYK কনভার্ট করুন শেড প্যালেট সহ',
    category: 'developer',
    icon: Palette,
    gradient: 'from-purple-500 to-fuchsia-600',
    keywords: ['রং', 'কালার', 'রঙ', 'hex', 'rgb', 'hsl', 'cmyk', 'color', 'palette', 'shade'],
    Component: ColorToolTool,
  },
  {
    id: 'json-formatter',
    nameBn: 'JSON ফরম্যাটার',
    nameEn: 'JSON Formatter',
    descBn: 'JSON ফরম্যাট, মিনিফাই ও ভ্যালিডেট করুন — এরর লোকেশন সহ',
    category: 'developer',
    icon: Braces,
    gradient: 'from-lime-500 to-green-700',
    keywords: ['json', 'format', 'প্রোগ্রামিং', 'dev', 'api', 'validate', 'beautify'],
    Component: JsonFormatterTool,
  },
  {
    id: 'base64-tool',
    nameBn: 'এনকোডার / ডিকোডার',
    nameEn: 'Base64 & URL Encoder',
    descBn: 'টেক্সকে Base64 বা URL ফরম্যাটে এনকোড-ডিকোড করুন',
    category: 'developer',
    icon: Binary,
    gradient: 'from-yellow-500 to-amber-700',
    keywords: ['base64', 'encode', 'decode', 'url', 'এনকোড', 'ডিকোড', 'encoder'],
    Component: Base64ToolTool,
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
    const haystack = [t.nameBn, t.nameEn, t.descBn, t.keywords.join(' '), t.category].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

export type { Tool, ToolCategoryMeta, ToolCategoryId }
