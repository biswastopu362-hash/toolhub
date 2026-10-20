'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeftRight, Binary, Copy, Link2, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Unicode-safe codecs                                                 */
/* ================================================================== */

/** Uint8Array → binary string in 32k chunks (avoids spread stack overflow on large inputs) */
function bytesToBinaryString(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

/** UTF-8 text → Base64 (Unicode safe) */
function encodeBase64(text: string): string {
  return btoa(bytesToBinaryString(new TextEncoder().encode(text)))
}

/** Base64 → UTF-8 text (Unicode safe, throws on invalid input) */
function decodeBase64(text: string): string {
  const clean = text.replace(/\s+/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

type Mode = 'encode' | 'decode' | 'url'
type UrlDir = 'encode' | 'decode'

interface ConvertResult {
  output: string
  error: string | null
  errorTitle: string
}

export default function Base64ToolTool() {
  const { toast } = useToast()
  const [mode, setMode] = useState<Mode>('encode')
  const [urlDir, setUrlDir] = useState<UrlDir>('encode')
  const [input, setInput] = useState('')

  /* Live conversion — fully derived state, no effects needed */
  const { output, error, errorTitle } = useMemo<ConvertResult>(() => {
    if (!input) return { output: '', error: null, errorTitle: '' }
    try {
      if (mode === 'encode') return { output: encodeBase64(input), error: null, errorTitle: '' }
      if (mode === 'decode') return { output: decodeBase64(input), error: null, errorTitle: '' }
      return urlDir === 'encode'
        ? { output: encodeURIComponent(input), error: null, errorTitle: '' }
        : { output: decodeURIComponent(input), error: null, errorTitle: '' }
    } catch {
      if (mode === 'decode') {
        return {
          output: '',
          error: 'Input is not valid Base64 — check for invalid characters, spaces, or padding (=).',
          errorTitle: 'Invalid Base64',
        }
      }
      if (mode === 'url' && urlDir === 'decode') {
        return {
          output: '',
          error: 'Input is not properly URL-encoded (e.g. %20 sequences) — check and try again.',
          errorTitle: 'Invalid URL encoding',
        }
      }
      return { output: '', error: 'Conversion failed — check the input.', errorTitle: 'Error' }
    }
  }, [input, mode, urlDir])

  const byteLen = (s: string): number => new TextEncoder().encode(s).length
  const inBytes = byteLen(input)
  const outBytes = byteLen(output)

  const swap = () => {
    if (!output) return
    setInput(output)
    if (mode === 'encode') setMode('decode')
    else if (mode === 'decode') setMode('encode')
    else setUrlDir((d) => (d === 'encode' ? 'decode' : 'encode'))
  }

  const clearAll = () => {
    setInput('')
  }

  const copyOutput = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      toast({ title: 'Copied ✓', description: 'Output saved to clipboard' })
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  const placeholder =
    mode === 'encode'
      ? 'Enter text to encode… (any Unicode works)'
      : mode === 'decode'
        ? 'Paste Base64 to decode… (e.g. aGk=)'
        : urlDir === 'encode'
          ? 'Enter text to URL-encode…'
          : 'Paste a %20-style string to decode…'

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden shadow-md">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <Tabs
            value={mode}
            onValueChange={(v) => (v === 'encode' || v === 'decode' || v === 'url') && setMode(v)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="encode">Text → Base64</TabsTrigger>
              <TabsTrigger value="decode">Base64 → Text</TabsTrigger>
              <TabsTrigger value="url" className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                URL Encode
              </TabsTrigger>
            </TabsList>

            {/* URL direction toggle lives inside the URL tab */}
            <TabsContent value="url" className="pt-2">
              <div
                className="inline-flex overflow-hidden rounded-lg border"
                role="group"
                aria-label="Select URL encode or decode"
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setUrlDir('encode')}
                  aria-pressed={urlDir === 'encode'}
                  className={cn(
                    'h-9 rounded-none px-4 text-sm',
                    urlDir === 'encode' && 'bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                >
                  Encode
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setUrlDir('decode')}
                  aria-pressed={urlDir === 'decode'}
                  className={cn(
                    'h-9 rounded-none px-4 text-sm',
                    urlDir === 'decode' && 'bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                >
                  Decode
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="b64-input" className="text-sm font-medium">
                Input
              </Label>
              <span className="text-xs text-muted-foreground">
                {inBytes.toLocaleString('en-US')} bytes
              </span>
            </div>
            <Textarea
              id="b64-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              className="min-h-[120px] font-mono text-sm"
              spellCheck={false}
              aria-label="Input text"
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={swap}
              disabled={!output}
              className="h-11"
              aria-label="Swap input and output"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Swap
            </Button>
            <Button
              variant="ghost"
              onClick={clearAll}
              disabled={!input}
              className="h-11 gap-1 text-destructive hover:text-destructive"
              aria-label="Clear input"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
            <div className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Binary className="h-3.5 w-3.5" />
              Input {inBytes.toLocaleString('en-US')} bytes · Output {outBytes.toLocaleString('en-US')}{' '}
              bytes
            </div>
          </div>

          {/* Output */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="b64-output" className="text-sm font-medium">
                Output
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1"
                onClick={copyOutput}
                disabled={!output}
                aria-label="Copy output"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>

            {error ? (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>{errorTitle}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : (
              <div
                id="b64-output"
                aria-live="polite"
                aria-label="Conversion output"
                className="max-h-48 min-h-[80px] overflow-y-auto whitespace-pre-wrap break-all rounded-xl border bg-muted/30 p-3 font-mono text-sm select-all"
              >
                {output || (
                  <span className="pointer-events-none opacity-40">
                    Live conversion result will appear here…
                  </span>
                )}
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Tip: any Unicode text (emoji, accented scripts, etc.) encodes and decodes correctly in the
            Text tab; pressing Swap moves the output back into the input and flips the direction.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
