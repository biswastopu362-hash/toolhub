/**
 * Ambient type declarations for `gifenc@1.0.3`.
 *
 * The package ships JavaScript only (no `types`/`typings` field, no bundled
 * `.d.ts`), so this file describes the small surface GIF Maker uses:
 * GIFEncoder + quantize + applyPalette. Signatures follow the upstream
 * README (mattdesl/gifenc).
 */

declare module 'gifenc' {
  /** Options accepted by {@link GifEncoderInstance.writeFrame}. */
  export interface GifWriteFrameOptions {
    /** Palette for this frame — array of `[r, g, b]` tuples (or flat arrays). */
    palette?: number[][]
    /** Mark as the first frame (header/repeat state is written here). */
    first?: boolean
    /** Enable binary transparency for this frame. */
    transparent?: boolean
    /** Palette index that should be treated as transparent. */
    transparentIndex?: number
    /** Frame delay in milliseconds. */
    delay?: number
    /** Loop count; `0` loops forever. */
    repeat?: number
    /** Frame disposal method (0–3). */
    dispose?: number
  }

  export interface GifEncoderInstance {
    /** Queue one indexed-color frame. */
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions,
    ): void
    /** Flush the trailer and finalize the stream. */
    finish(): void
    /** A copy of the encoded GIF bytes. */
    bytes(): Uint8Array
    /** A view into the internal buffer (no copy). */
    bytesView(): Uint8Array
    /** Reset the encoder so it can encode a fresh stream. */
    reset(): void
  }

  export interface QuantizeOptions {
    /** Color sampling format — must match `applyPalette`. */
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaColor?: number
    clearAlphaThreshold?: number
  }

  /** Build a ≤ maxColors palette from RGBA pixel data. */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): number[][]

  /** Map RGBA pixels to palette indices (LZW-ready). */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array

  export function GIFEncoder(options?: {
    auto?: boolean
    initialCapacity?: number
  }): GifEncoderInstance

  export function nearestColorIndex(
    palette: number[][],
    pixel: readonly number[],
  ): number

  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    options?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number },
  ): void
}
