/**
 * OKLab / OKLCh colour math shared by the skin generator and the browser.
 *
 * Everything here is pure and deterministic: the same seeds always produce the
 * same ramp, so `scripts/build-skins.mjs` output is byte-stable and reviewable
 * in a diff, and a custom skin derived in the browser lands on exactly the
 * colours the Host would have derived for the same seeds. No dependencies —
 * the whole conversion chain is ~80 lines of matrix math (Björn Ottosson's
 * OKLab, 2020).
 *
 * This file was `scripts/lib/color.mjs`; it moved into `src/` when the custom
 * skin made the derivation a runtime concern rather than a build-time one.
 */

/** A colour in OKLCh: lightness 0..1, chroma, hue in degrees. */
export type Oklch = readonly [L: number, C: number, h: number]

/** A colour in linear-light sRGB, 0..1 per channel. */
export type Linear = readonly [r: number, g: number, b: number]

/** An 8-bit sRGB triple. */
export type Rgb8 = readonly [r: number, g: number, b: number]

/** Clamp a number into a closed range. */
const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value

/** sRGB transfer function (linear → gamma-encoded). */
const encode = (c: number): number => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

/** Inverse sRGB transfer function (gamma-encoded → linear). */
const decode = (c: number): number => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

/**
 * Parse one opaque CSS colour into 0..255 channels. Accepts `#rgb`, `#rrggbb`
 * and `rgb(r, g, b)` — upstream's design-platform.css writes the stock ramps
 * in `rgb()` while theme files use hex, so both have to read.
 * @param color - CSS colour string.
 * @returns 8-bit RGB triple.
 */
export function parseColor(color: string): Rgb8 {
  const raw = color.trim()
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(raw)
  if (fn !== null) {
    const [r, g, b] = [Number(fn[1]), Number(fn[2]), Number(fn[3])]
      .map(c => clamp(Math.round(c), 0, 255))
    return [r, g, b] as Rgb8
  }
  let h = raw.replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`bad color: ${color}`)
  const int = Number.parseInt(h, 16)
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
}

/**
 * Format an 8-bit triple as `#rrggbb`.
 * @param rgb - 8-bit RGB triple.
 * @returns lowercase hex string.
 */
export function rgbToHex(rgb: Rgb8): string {
  return `#${rgb.map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Parse any supported CSS colour into linear-light RGB channels.
 * @param color - CSS colour string.
 * @returns linear RGB triple in 0..1.
 */
export function hexToLinear(color: string): Linear {
  const [r, g, b] = parseColor(color)
  return [decode(r / 255), decode(g / 255), decode(b / 255)]
}

/**
 * Encode linear-light RGB back to a `#rrggbb` string, clipping out-of-gamut
 * channels. Callers that care about gamut should run {@link fitGamut} first.
 * @param rgb - linear RGB triple.
 * @returns lowercase hex string.
 */
export function linearToHex([r, g, b]: Linear): string {
  const to255 = (c: number): number => Math.round(clamp(encode(clamp(c, 0, 1)), 0, 1) * 255)
  return rgbToHex([to255(r), to255(g), to255(b)])
}

/**
 * Linear RGB → OKLab.
 * @param rgb - linear RGB triple.
 * @returns OKLab triple.
 */
export function linearToOklab([r, g, b]: Linear): readonly [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

/**
 * OKLab → linear RGB.
 * @param lab - OKLab triple.
 * @returns linear RGB triple (possibly out of gamut).
 */
export function oklabToLinear([L, a, b]: readonly [number, number, number]): Linear {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

/**
 * OKLab → OKLCh.
 * @param lab - OKLab triple.
 * @returns OKLCh triple with hue in degrees.
 */
export function oklabToOklch([L, a, b]: readonly [number, number, number]): Oklch {
  const C = Math.hypot(a, b)
  let h = Math.atan2(b, a) * 180 / Math.PI
  if (h < 0) h += 360
  return [L, C, h]
}

/**
 * OKLCh → OKLab.
 * @param oklch - OKLCh triple.
 * @returns OKLab triple.
 */
export function oklchToOklab([L, C, h]: Oklch): readonly [number, number, number] {
  const rad = h * Math.PI / 180
  return [L, C * Math.cos(rad), C * Math.sin(rad)]
}

/**
 * Parse a CSS colour straight into OKLCh.
 * @param hex - CSS colour string.
 * @returns OKLCh triple.
 */
export function hexToOklch(hex: string): Oklch {
  return oklabToOklch(linearToOklab(hexToLinear(hex)))
}

/** Whether a linear RGB triple sits inside the sRGB gamut. */
const inGamut = (rgb: Linear): boolean => rgb.every(c => c >= -1e-4 && c <= 1 + 1e-4)

/**
 * Reduce chroma until the colour fits inside sRGB, preserving lightness and
 * hue. Binary search over chroma is the standard CSS Color 4 approach and
 * keeps ramps smooth where a naive per-channel clip would flatten them.
 * @param oklch - target OKLCh triple.
 * @returns in-gamut linear RGB.
 */
export function fitGamut([L, C, h]: Oklch): Linear {
  const direct = oklabToLinear(oklchToOklab([L, C, h]))
  if (inGamut(direct)) return direct
  let lo = 0
  let hi = C
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (inGamut(oklabToLinear(oklchToOklab([L, mid, h])))) lo = mid
    else hi = mid
  }
  return oklabToLinear(oklchToOklab([L, lo, h]))
}

/**
 * Build a hex colour from OKLCh, gamut-fitted.
 * @param oklch - OKLCh triple.
 * @returns lowercase hex string.
 */
export function oklchToHex(oklch: Oklch): string {
  return linearToHex(fitGamut(oklch))
}

/**
 * WCAG 2.1 relative luminance, used by the readability contract.
 * @param hex - CSS colour string.
 * @returns relative luminance in 0..1.
 */
export function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * WCAG 2.1 contrast ratio between two colours.
 * @param a - first colour.
 * @param b - second colour.
 * @returns contrast ratio in 1..21.
 */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Format an `rgba()` string from any supported CSS colour plus an alpha.
 * @param color - CSS colour string.
 * @param alpha - alpha channel in 0..1.
 * @returns an `rgba()` string.
 */
export function rgba(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Composite an opaque wash of `over` at `alpha` on top of an opaque `under`.
 * The custom skin audits against this rather than against the bare surface,
 * because a translucent veil means the colour body text actually sits on is
 * part photograph.
 * @param over - the wash colour.
 * @param alpha - the wash's alpha in 0..1.
 * @param under - the colour showing through.
 * @returns the composited opaque hex.
 */
export function composite(over: string, alpha: number, under: string): string {
  const a = parseColor(over)
  const b = parseColor(under)
  return rgbToHex([
    a[0] * alpha + b[0] * (1 - alpha),
    a[1] * alpha + b[1] * (1 - alpha),
    a[2] * alpha + b[2] * (1 - alpha),
  ])
}
