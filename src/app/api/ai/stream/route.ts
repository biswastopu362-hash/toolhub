import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Accept system (personas), user and assistant messages; clamp size and count. */
function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if (
      (role === 'system' || role === 'user' || role === 'assistant') &&
      typeof content === 'string' &&
      content.trim()
    ) {
      out.push({ role, content: content.slice(0, 8000) })
    }
    if (out.length >= 24) break
  }
  return out
}

/**
 * SDK quirk: with `stream: true` the z-ai-web-dev-sdk async iterator yields
 * the raw SSE text spread into a plain object with NUMERIC keys (char codes),
 * e.g. { "0": 100, "1": 97, ... } → "data: {...}\n\n". Reassemble it.
 * Normal OpenAI-shaped chunks (and plain strings) pass through unchanged.
 */
function chunkToText(c: unknown): string {
  if (typeof c === 'string') return c
  if (c && typeof c === 'object') {
    const rec = c as Record<string, unknown>
    const keys = Object.keys(rec)
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      let s = ''
      for (let i = 0; i < keys.length; i++) {
        const v = rec[i]
        if (typeof v === 'number') s += String.fromCharCode(v)
      }
      return s
    }
  }
  return ''
}

/** Extract a delta string from a parsed OpenAI-style chunk object. */
function deltaOf(obj: unknown): string {
  const delta = (obj as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices?.[0]
    ?.delta?.content
  return typeof delta === 'string' ? delta : ''
}

/**
 * NDJSON streaming chat endpoint.
 * Each line is a JSON object: { t: 'delta', v: string } | { t: 'done' } | { t: 'error', v: string }.
 * Falls back to a single non-streamed delta if the SDK ignores `stream: true`.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null
  const messages = sanitizeMessages(body?.messages)
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') {
    return Response.json({ error: 'Send a conversation ending with a user message.' }, { status: 400 })
  }

  let zai: Awaited<ReturnType<typeof ZAI.create>>
  try {
    zai = await ZAI.create()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI service unavailable'
    console.error('[api/ai/stream]', message)
    return Response.json({ error: `AI request failed: ${message}` }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        const completion = await zai.chat.completions.create({
          messages,
          stream: true,
          thinking: { type: 'disabled' },
        })

        const iterable = completion as AsyncIterable<unknown> | null
        if (iterable && typeof iterable[Symbol.asyncIterator] === 'function') {
          /* Buffer the reassembled SSE text and parse `data: {...}` lines. */
          let sse = ''
          for await (const chunk of iterable) {
            sse += chunkToText(chunk)
            const lines = sse.split('\n')
            sse = lines.pop() ?? '' // keep the trailing partial line in the buffer
            for (const line of lines) {
              const t = line.trim()
              if (!t.startsWith('data:')) continue
              const payload = t.slice(5).trim()
              if (!payload || payload === '[DONE]') continue
              try {
                const delta = deltaOf(JSON.parse(payload))
                if (delta) send({ t: 'delta', v: delta })
              } catch {
                /* malformed keep-alive or comment — ignore */
              }
            }
          }
          /* flush the tail line */
          const tail = sse.trim()
          if (tail.startsWith('data:') && !tail.includes('[DONE]')) {
            try {
              const delta = deltaOf(JSON.parse(tail.slice(5).trim()))
              if (delta) send({ t: 'delta', v: delta })
            } catch {
              /* ignore */
            }
          }
        } else {
          const reply =
            (completion as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
              ?.message?.content
          if (typeof reply === 'string' && reply.trim()) send({ t: 'delta', v: reply })
        }
        send({ t: 'done' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected server error'
        console.error('[api/ai/stream]', message)
        send({ t: 'error', v: `AI request failed: ${message}` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
