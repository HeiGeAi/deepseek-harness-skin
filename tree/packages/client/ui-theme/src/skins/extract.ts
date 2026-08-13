/**
 * Turn a photograph into a skin.
 *
 * The four seeds a skin is built from are read out of the image itself: the
 * background the picture mostly is becomes `surface`, the most saturated colour
 * that carries real area becomes `accent`, a second distinct hue becomes
 * `secondary`, and `text` is the far end of the neutral ramp tinted to match.
 * Everything after that is the same derivation the built-in skins go through,
 * so a custom skin lands on the same contrast structure rather than on a second
 * set of rules.
 *
 * Then the wash gets tuned. A built-in skin ships an art-directed hero and a
 * fixed veil; a custom one has whatever the user picked, so the veil is raised
 * until body text clears its threshold against the *composite* — the surface
 * washed over the brightest and the darkest part of that particular
 * photograph — rather than against the bare surface the audit normally assumes.
 * A bright photo behind a light skin is exactly the case where the two numbers
 * come apart.
 *
 * Pixel input is a plain RGBA array, so this file has no DOM dependency and the
 * whole path is testable without a canvas.
 */

import { composite, contrast, hexToOklch, luminance, oklchToHex, rgbToHex } from './color.ts'
import {
  auditSkin, deriveSkin, resolveToken, type AuditEntry, type SkinAppearance, type SkinChrome,
  type SkinSeeds, type SkinTheme,
} from './derive.ts'
import type { StockData } from './stock.ts'

/** One quantized colour bucket and how much of the image it covers. */
interface Bucket {
  /** Bucket mean colour as hex. */
  hex: string
  /** Share of sampled pixels, 0..1. */
  weight: number
  /** OKLCh of the mean colour. */
  oklch: readonly [number, number, number]
}

/** What a photograph yields before the ramp derivation runs. */
export interface ExtractedPalette {
  /** The four derived seeds. */
  seeds: SkinSeeds
  /** Which scheme the image's overall brightness puts it in. */
  appearance: SkinAppearance
  /** The chrome preset picked to suit that scheme. */
  chrome: SkinChrome
  /**
   * The brightest and darkest colours with real area in the image. The veil is
   * tuned against these because they bracket what body text can end up sitting
   * on once the wash is translucent.
   */
  extremes: readonly string[]
}

/** Quantize to 5 bits per channel: fine enough to separate hues, coarse enough to pool area. */
const QUANT = 5

/** A bucket under this share of the image is noise, not a colour the picture has. */
const MIN_AREA = 0.005

/**
 * Histogram an RGBA buffer into mean-coloured buckets, heaviest first.
 * @param pixels - RGBA bytes, four per pixel.
 * @returns buckets covering the whole image, sorted by descending area.
 */
function bucketize(pixels: Uint8ClampedArray): Bucket[] {
  const sums = new Map<number, [count: number, r: number, g: number, b: number]>()
  let total = 0
  // Whole pixels only, read through a view whose byte reads are total: indexing
  // the array directly would type every read as possibly-undefined and litter
  // the histogram with defaults that the loop bound already rules out.
  const bytes = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const end = pixels.length - (pixels.length % 4)
  for (let i = 0; i < end; i += 4) {
    // Fully transparent pixels are not part of the picture.
    if (bytes.getUint8(i + 3) < 8) continue
    const r = bytes.getUint8(i)
    const g = bytes.getUint8(i + 1)
    const b = bytes.getUint8(i + 2)
    const shift = 8 - QUANT
    const key = ((r >> shift) << (QUANT * 2)) | ((g >> shift) << QUANT) | (b >> shift)
    const entry = sums.get(key)
    if (entry === undefined) sums.set(key, [1, r, g, b])
    else { entry[0] += 1; entry[1] += r; entry[2] += g; entry[3] += b }
    total += 1
  }
  if (total === 0) throw new Error('image has no opaque pixels')
  const out: Bucket[] = []
  for (const [count, r, g, b] of sums.values()) {
    const hex = rgbToHex([r / count, g / count, b / count])
    out.push({ hex, weight: count / total, oklch: hexToOklch(hex) })
  }
  return out.sort((a, b) => b.weight - a.weight)
}

/** Clamp a number into a closed range. */
const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value

/**
 * Read four seeds out of an image.
 *
 * @param pixels - RGBA bytes of a downscaled copy of the image.
 * @returns the seeds, the scheme they belong to, and the image's extremes.
 */
export function extractPalette(pixels: Uint8ClampedArray): ExtractedPalette {
  const buckets = bucketize(pixels)
  const area = buckets.filter(b => b.weight >= MIN_AREA)
  // `area` can be empty for a photograph with no colour covering half a percent
  // — a dense gradient — in which case the heaviest buckets are still the right
  // sample, just individually small.
  const solid = area.length > 0 ? area : buckets.slice(0, 8)

  // Mean brightness decides the scheme. Weighted by area, so a small blown-out
  // highlight does not make a night scene into a light skin.
  const mean = solid.reduce((sum, b) => sum + luminance(b.hex) * b.weight, 0)
    / solid.reduce((sum, b) => sum + b.weight, 0)
  const appearance: SkinAppearance = mean >= 0.34 ? 'light' : 'dark'

  // Surface: the colour the picture mostly is, pushed into a band the ramp can
  // work in and desaturated so the page does not compete with its own content.
  // Keeping the hue is what makes a warm photo produce a warm interface.
  const dominant = solid[0]
  /* v8 ignore next -- bucketize throws on an empty image, so `solid` has at least one entry */
  if (dominant === undefined) throw new Error('image yielded no colours')
  const surface = appearance === 'light'
    ? oklchToHex([clamp(dominant.oklch[0], 0.9, 0.985), Math.min(dominant.oklch[1], 0.03), dominant.oklch[2]])
    : oklchToHex([clamp(dominant.oklch[0], 0.08, 0.24), Math.min(dominant.oklch[1], 0.05), dominant.oklch[2]])

  // Accent: the most saturated colour with real area, held at a lightness that
  // works as a fill. Mid-lightness is deliberate — the derivation moves it from
  // here when a role needs more contrast, and starting at an extreme would give
  // it nothing to move from.
  const chromatic = solid
    .filter(b => b.oklch[0] > 0.2 && b.oklch[0] < 0.92)
    .sort((a, b) => b.oklch[1] - a.oklch[1])
  const accentSource = chromatic[0] ?? dominant
  const accentC = Math.max(accentSource.oklch[1], 0.06)
  const accent = oklchToHex([
    clamp(accentSource.oklch[0], appearance === 'light' ? 0.45 : 0.55, 0.8),
    accentC,
    accentSource.oklch[2],
  ])

  // Secondary: the next hue that is actually a different hue. A photograph with
  // one colour story falls back to a muted neighbour of the accent, which is
  // what the built-in single-hue skins do by hand.
  const accentHue = accentSource.oklch[2]
  const apart = chromatic.find(b => Math.abs(((b.oklch[2] - accentHue + 540) % 360) - 180) > 25)
  const secondary = apart === undefined
    ? oklchToHex([clamp(hexToOklch(accent)[0] + (appearance === 'light' ? 0.12 : -0.08), 0.3, 0.85), accentC * 0.45, (accentHue + 20) % 360])
    : oklchToHex([clamp(apart.oklch[0], 0.4, 0.85), Math.min(apart.oklch[1], accentC), apart.oklch[2]])

  // Text anchors the far end of the neutral ramp. Tinted with the surface hue so
  // the ramp between them stays in one colour family.
  const surfaceOklch = hexToOklch(surface)
  const text = appearance === 'light'
    ? oklchToHex([0.24, Math.min(surfaceOklch[1] + 0.01, 0.035), surfaceOklch[2]])
    : oklchToHex([0.93, Math.min(surfaceOklch[1] + 0.01, 0.03), surfaceOklch[2]])

  // Brightest and darkest colours with real area: the two backdrops body text
  // can end up over once the wash lets the picture through. Scanned rather than
  // sorted so both ends start from a bucket that is known to exist.
  let darkest = dominant
  let brightest = dominant
  for (const bucket of solid) {
    if (luminance(bucket.hex) < luminance(darkest.hex)) darkest = bucket
    if (luminance(bucket.hex) > luminance(brightest.hex)) brightest = bucket
  }
  const extremes = [darkest.hex, brightest.hex]

  return {
    seeds: { accent, secondary, surface, text },
    appearance,
    chrome: appearance === 'light' ? 'glass' : 'neon',
    extremes,
  }
}

/**
 * The roles whose legibility genuinely depends on how much photograph shows
 * through, each with the alias it paints with. The contract labels the audit
 * reports under are the keys, so the veil search picks its pairs out of the
 * audit by lookup rather than by keeping a second list in step with this one.
 */
const VEIL_CONTRACT: Record<string, string | undefined> = {
  正文: '--dsw-alias-label-primary',
  次要文字: '--dsw-alias-label-secondary',
  三级文字: '--dsw-alias-label-tertiary',
}

/** A tuned custom skin: the theme to persist plus the evidence it passed. */
export interface TunedSkin {
  /** The theme definition, whose veil is whatever the tuning settled on. */
  theme: SkinTheme & { veil: number }
  /** Contract results measured against the bare surface. */
  audit: AuditEntry[]
  /**
   * The worst ratio each veil-sensitive role reaches against the composite of
   * surface-over-photograph, at the veil that was chosen.
   */
  composited: AuditEntry[]
  /** Whether every audited pair cleared its threshold. */
  pass: boolean
}

/**
 * Derive a custom skin and raise its wash until the photograph stops eating the
 * text contrast.
 *
 * The palette does not depend on the veil — every neutral step is solved
 * against the opaque surface — so the ramp is derived once and only the wash is
 * searched. The search walks upward from the built-in default in small steps
 * and stops at the first veil that clears every veil-sensitive pair against
 * both of the image's extremes; at the ceiling the composite is within a
 * rounding step of the surface itself, so failing there means the seeds are
 * wrong rather than the wash.
 *
 * @param extracted - what {@link extractPalette} read out of the image.
 * @param stock - upstream's parsed palette and semantic layer.
 * @returns the tuned theme and both audits.
 */
export function tuneCustomSkin(extracted: ExtractedPalette, stock: StockData): TunedSkin {
  const base: SkinTheme = {
    id: 'custom',
    appearance: extracted.appearance,
    chrome: extracted.chrome,
    seeds: extracted.seeds,
  }
  const derived = deriveSkin(base, stock)
  const audit = auditSkin(base, derived, stock)

  // Resolve the veil-sensitive foregrounds once; only the backdrop moves. A
  // role whose alias chain leads nowhere paints nothing, so it carries no
  // foreground and the search has nothing to measure for it.
  const layer = { ...stock.aliases[base.appearance], ...derived.brand }
  const sensitive: { entry: AuditEntry; fg: string | null }[] = []
  for (const entry of audit) {
    const token = VEIL_CONTRACT[entry.label]
    if (token === undefined) continue
    sensitive.push({ entry, fg: resolveToken(token, layer, derived.palette) })
  }

  const start = extracted.appearance === 'light' ? 0.82 : 0.86
  let chosen = start
  let composited: AuditEntry[] = []
  for (let veil = start; veil <= 0.985; veil = Number((veil + 0.02).toFixed(2))) {
    composited = sensitive.map(({ entry, fg }) => {
      if (fg === null) return { ...entry, ratio: null, pass: true }
      const ratio = Math.min(...extracted.extremes.map(extreme =>
        contrast(fg, composite(extracted.seeds.surface, veil, extreme))))
      return { label: entry.label, ratio, min: entry.min, pass: ratio >= entry.min }
    })
    chosen = veil
    if (composited.every(entry => entry.pass)) break
  }

  const theme = { ...base, veil: chosen }
  return {
    theme,
    audit,
    composited,
    pass: audit.every(e => e.pass) && composited.every(e => e.pass),
  }
}

