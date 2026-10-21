import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT = [
  'You are ToolHub AI Assistant, a friendly, capable helper inside an all-in-one app hub.',
  'You help users write, translate, summarize, plan, brainstorm and answer questions.',
  'Be concise and well-structured; use Markdown headings, bullet points and code blocks when useful.',
  'If the user writes in Bengali or any other language, reply in that same language unless they ask otherwise.',
].join(' ')

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      out.push({ role, content: content.slice(0, 8000) })
    }
    if (out.length >= 16) break
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { messages?: unknown } | null
    const messages = sanitizeMessages(body?.messages)

    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user') {
      return NextResponse.json({ error: 'Send a conversation ending with a user message.' }, { status: 400 })
    }

    const zai = await ZAI.create()

    const completion = await zai.chat.completions.create({
      messages: [{ role: 'assistant', content: SYSTEM_PROMPT }, ...messages],
      thinking: { type: 'disabled' },
    })

    const reply = completion.choices[0]?.message?.content?.trim()
    if (!reply) {
      return NextResponse.json({ error: 'The assistant returned an empty reply.' }, { status: 502 })
    }

    return NextResponse.json({ reply })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    console.error('[api/ai]', message)
    return NextResponse.json({ error: `AI request failed: ${message}` }, { status: 500 })
  }
}
