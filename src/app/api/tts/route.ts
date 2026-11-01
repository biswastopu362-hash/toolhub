import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/tts — text → spoken audio (WAV).
 * Body: { text: string (≤1000 chars), voice?: string, speed?: number }
 * Returns the generated audio as a binary WAV response.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { text?: unknown; voice?: unknown; speed?: unknown }
      | null

    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'Text is required.' }, { status: 400 })
    }
    if (text.length > 1000) {
      return NextResponse.json(
        { error: 'Text is too long — split it into chunks of 1000 characters or fewer.' },
        { status: 400 }
      )
    }

    const VOICES = new Set(['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'])
    const voice = typeof body?.voice === 'string' && VOICES.has(body.voice) ? body.voice : 'tongtong'
    const rawSpeed = typeof body?.speed === 'number' ? body.speed : 1
    const speed = Math.min(2, Math.max(0.5, rawSpeed))

    const zai = await ZAI.create()
    const response = await zai.audio.tts.create({
      input: text,
      voice,
      speed,
      response_format: 'wav',
      stream: false,
    })

    const arrayBuffer = await response.arrayBuffer()
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty audio returned by the speech service.' }, { status: 502 })
    }

    return new NextResponse(Buffer.from(new Uint8Array(arrayBuffer)), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(arrayBuffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('TTS API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Speech generation failed. Please try again.' },
      { status: 500 }
    )
  }
}
