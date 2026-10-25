import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/asr — audio → text transcript.
 * Body: { audio: base64 string } (JSON) — any common audio format (wav/mp3/webm/m4a…).
 * Privacy: the clip is transcribed in memory and never stored server-side.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { audio?: unknown } | null

    const audio = typeof body?.audio === 'string' ? body.audio : ''
    if (!audio) {
      return NextResponse.json({ error: 'Audio data is required.' }, { status: 400 })
    }
    // ~20 MB base64 ceiling (covers several minutes of compressed speech).
    if (audio.length > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Recording is too long — keep clips under a few minutes.' },
        { status: 413 }
      )
    }

    const zai = await ZAI.create()
    const response = await zai.audio.asr.create({ file_base64: audio })
    const text = (response?.text ?? '').toString().trim()

    return NextResponse.json({ text })
  } catch (error) {
    console.error('ASR API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed. Please try again.' },
      { status: 500 }
    )
  }
}
