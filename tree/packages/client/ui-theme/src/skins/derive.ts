/**
 * Skin derivation: four seed colours → the full `--dsw-*` palette, the brand
 * roles, and the `--skin-*` chrome inputs.
 *
 * Why derive. Upstream's design-platform.css is a two-layer system: 73
 * absolute palette steps (`--dsw-static-*`) and 89 semantic tokens
 * (`--dsw-alias-*`, `--dsw-specific-*`) that are almost entirely `var()`
 * references onto those steps, with light and dark differing only in which step
 * each alias points at. A skin therefore only has to restate the palette; the
 * whole semantic layer follows for free, in both schemes, and stays correct
 * when upstream re-maps an alias.
 *
 * Neutral steps reproduce upstream's *contrast ratio* against the background,
 * not its absolute lightness, and take hue and chroma from the skin's seeds.
 * That is what makes the readability contract hold by construction: upstream's
 * own ramp passes WCAG AA, so a ramp that hits the same ratios against a
 * different backdrop passes too. Remapping lightness linearly instead — the
 * obvious first try — silently compresses the mid steps whenever a skin's text
 * seed is a mid-dark navy rather than near-black, and secondary/tertiary labels
 * drop under 4.5:1.
 *
 * Accent ramps are the exception: there the seed itself is the point, so the
 * ramp is recentred on it with a piecewise remap that pins the primary step and
 * preserves step ordering.
 *
 * This module is pure and environment-free on purpose. `scripts/build-skins.mjs`
 * runs it over `themes/*.json` at build time; the browser runs it over seeds
 * sampled from a user's own photograph, and the Host runs it again at boot to
 * emit the same variables before first paint. One implementation, three
 * callers, so a custom skin cannot drift from a built-in one.
 */

import {
  contrast, hexToOklch, luminance, oklchToHex, parseColor, rgba, rgbToHex, type Oklch,
} from './color.ts'
import type { StockData, StockStep } from './stock.ts'

/**
 * Read an entry that the generated stock data is required to carry.
 *
 * Every call below names a palette family, step, or semantic token that
 * `scripts/build-skins.mjs` extracted from `design-platform.css`. A miss means
 * `generated/stock.ts` has fallen behind that file — a build state, not a
 * runtime condition — so it fails loudly rather than deriving a ramp around a
 * colour nobody chose.
 * @param value - the looked-up entry.
 * @param name - what was being looked up, for the error.
 * @returns the entry.
 */
function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`stock palette is missing ${name}`)
  return value
}

/**
 * Read one palette family the derivation is written against.
 * @param stock - upstream's parsed palette.
 * @param name - the family's custom-property prefix.
 * @returns the family's steps, lightest first.
 */
function family(stock: StockData, name: string): StockStep[] {
  return required(stock.families[name], name)
}

/** Visual appearance a skin pins the UI to. */
export type SkinAppearance = 'light' | 'dark'

/** Shared component treatment a skin wears (see styles/skins/_chrome.css). */
export type SkinChrome = 'flat' | 'glass' | 'neon'

/** The four colours a whole skin is derived from. */
export interface SkinSeeds {
  /** The skin's voice: chat bubbles, the active sidebar item, the titlebar band. */
  accent: string
  /** The second voice: focus outlines, the titlebar's bottom edge, neon trim. */
  secondary: string
  /** The page background, used verbatim; every neutral step is solved against it. */
  surface: string
  /** Anchors the far end of the neutral ramp; hue and chroma survive, lightness is re-solved. */
  text: string
}

/** Everything the derivation needs about one skin. */
export interface SkinTheme {
  /** Stable id; scopes the emitted rules. */
  id: string
  /** The colour scheme this skin pins the UI to. */
  appearance: SkinAppearance
  /** Which shared component treatment the skin wears. */
  chrome: SkinChrome
  /** The four seeds. */
  seeds: SkinSeeds
  /**
   * How opaque the wash over the hero image is, 0..1. Built-in skins leave this
   * unset and take the per-appearance default; a custom skin tunes it upward
   * until its own photograph stops eating the text contrast.
   */
  veil?: number
  /** Background image filename, resolved to a URL by whoever renders the sheet. */
  hero?: string
  /** `background-position` for the hero, defaulting to dead centre. */
  heroFocus?: string
  /** Emoji stamped on the brand mark. */
  glyph?: string
  /** Whether the skin reveals AppFrame's decorative badge. */
  showBadge?: boolean
  /** `font-family` override, when the skin's era had a typeface. */
  font?: string
}

/** One skin's derived colours. */
export interface DerivedSkin {
  /** The `--dsw-static-*` palette. */
  palette: Record<string, string>
  /** The `--dsw-alias-*` brand roles stock points at near-black. */
  brand: Record<string, string>
  /** The `--skin-*` chrome inputs `_chrome.css` reads. */
  chrome: Record<string, string>
  /** How far the accent's lightness had to travel to clear its thresholds. */
  moved: number
}

/**
 * The palette step each scheme uses as its page background. Everything else in
 * a neutral ramp is derived from its contrast against this one.
 */
export const BG_STEP: Record<SkinAppearance, string> = {
  light: '--dsw-static-neutral-bluish-00',
  dark: '--dsw-static-neutral-bluish-950',
}

/** Default wash opacity over the hero, per appearance. */
const VEIL: Record<SkinAppearance, number> = { light: 0.82, dark: 0.86 }

/** Default wash opacity on the frame, which the transcript stacks onto. */
const VEIL_SOFT: Record<SkinAppearance, number> = { light: 0.62, dark: 0.7 }

// ── ramp derivation ─────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Interpolate hue along the shorter arc of the colour wheel. */
function lerpHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180
  return (a + delta * t + 360) % 360
}

/**
 * Find the lightness at which a given hue and chroma hits a target contrast
 * ratio against a backdrop. Contrast rises monotonically as lightness moves
 * away from the backdrop, so a bisection converges; it runs on the rendered,
 * gamut-fitted colour rather than the nominal one, which keeps the result
 * honest for chromatic seeds whose chroma gets clipped near the extremes.
 *
 * When the target is out of reach — a mid-dark surface can never put 17:1 under
 * any colour — the search saturates at the extreme, i.e. the best the skin can
 * do, and the audit reports the shortfall.
 * @param target - contrast ratio to reach.
 * @param backdrop - hex the step has to read against.
 * @param C - chroma to hold.
 * @param h - hue to hold.
 * @param darker - whether the step sits below the backdrop in lightness.
 * @returns lightness in 0..1.
 */
function solveLightness(target: number, backdrop: string, C: number, h: number, darker: boolean): number {
  const bgL = hexToOklch(backdrop)[0]
  if (target <= 1.0001) return bgL
  // `inside` is the end that meets the target if anything does, `outside` the
  // backdrop itself, where the ratio is 1.
  let inside = darker ? 0 : 1
  let outside = bgL
  for (let i = 0; i < 28; i += 1) {
    const mid = (inside + outside) / 2
    if (contrast(oklchToHex([mid, C, h]), backdrop) >= target) inside = mid
    else outside = mid
  }
  return inside
}

/**
 * Neutral ramps reproduce, against the skin's own background, the contrast
 * ratio each stock step has against upstream's background. Hue and chroma come
 * from interpolating the skin's two neutral seeds, so the ramp carries the
 * skin's tint while the alias layer keeps landing on legible colours.
 * @param steps - stock family steps, lightest first.
 * @param stockBg - upstream's background for the scheme being derived.
 * @param backdrop - the skin's background hex.
 * @param lightEnd - OKLCh of the skin colour that anchors the light end.
 * @param darkEnd - OKLCh of the skin colour that anchors the dark end.
 * @param chromaScale - how much of the seed chroma the ramp keeps.
 * @returns step name → hex.
 */
function deriveNeutral(
  steps: readonly StockStep[], stockBg: string, backdrop: string,
  lightEnd: Oklch, darkEnd: Oklch, chromaScale: number,
): Record<string, string> {
  const out: Record<string, string> = {}
  const Ls = steps.map(s => s.L)
  const lo = Math.min(...Ls)
  const hi = Math.max(...Ls)
  const bgL = hexToOklch(stockBg)[0]
  for (const step of steps) {
    // t: 0 at the ramp's lightest step, 1 at its darkest.
    const t = hi === lo ? 0 : (hi - step.L) / (hi - lo)
    const C = lerp(lightEnd[1], darkEnd[1], t) * chromaScale
    const h = lerpHue(lightEnd[2], darkEnd[2], t)
    const target = contrast(oklchToHex([step.L, step.C, step.h]), stockBg)
    const L = solveLightness(target, backdrop, C, h, step.L < bgL)
    out[step.name] = oklchToHex([L, C, h])
  }
  return out
}

/**
 * Accent ramps keep upstream's lightness spacing but recentre on the accent
 * seed: the primary step lands exactly on the seed, steps above it stretch
 * toward white and steps below toward the ramp floor. A uniform lightness shift
 * would collapse the light end against the ceiling for bright accents (a gold
 * accent pushed four steps past 1.0), so each side is remapped separately and
 * ordering is preserved by construction.
 * @param steps - stock family steps, lightest first.
 * @param anchor - stock step name the seed should land on.
 * @param seed - OKLCh of the accent seed.
 * @returns step name → hex.
 */
function deriveAccent(steps: readonly StockStep[], anchor: string, seed: Oklch): Record<string, string> {
  const ref = required(steps.find(s => s.name === anchor) ?? steps[Math.floor(steps.length / 2)], anchor)
  const [seedL, seedC, seedH] = seed
  const hi = Math.max(...steps.map(s => s.L))
  const lo = Math.min(...steps.map(s => s.L))
  const ceiling = 0.985
  const floor = Math.max(0.12, seedL - 0.5)
  // Chroma follows the stock silhouette, rescaled so the anchor matches the seed.
  const chromaScale = ref.C > 1e-6 ? seedC / ref.C : 1

  const out: Record<string, string> = {}
  for (const step of steps) {
    let L: number
    if (step.L >= ref.L) {
      const span = hi - ref.L
      L = span < 1e-6 ? seedL : lerp(seedL, ceiling, (step.L - ref.L) / span)
    } else {
      const span = ref.L - lo
      L = span < 1e-6 ? seedL : lerp(seedL, floor, (ref.L - step.L) / span)
    }
    out[step.name] = oklchToHex([L, step.C * chromaScale, seedH])
  }
  return out
}

/**
 * Walk an accent's lightness away from the page background until a predicate
 * holds, holding hue and chroma so the skin keeps its identity. A seed chosen
 * for how it looks as a bubble fill is often illegible as an outline or a
 * label — a gold on cream lands near 1.5:1 — and the accent roles carry
 * genuinely different thresholds, so each gets its own fit.
 *
 * The walk is a linear scan rather than a bisection because a predicate can
 * combine several contrast constraints, and their conjunction need not be
 * monotonic in lightness even though each term is.
 * @param seed - OKLCh of the accent seed.
 * @param appearance - light skins darken the accent, dark skins brighten it.
 * @param ok - predicate on the candidate hex.
 * @returns the fitted colour and how far lightness travelled.
 */
function fitAccent(
  seed: Oklch, appearance: SkinAppearance, ok: (hex: string) => boolean,
): { hex: string; moved: number } {
  const [L, C, h] = seed
  if (ok(oklchToHex(seed))) return { hex: oklchToHex(seed), moved: 0 }
  const dir = appearance === 'light' ? -1 : 1
  for (let i = 1; i <= 500; i += 1) {
    const next = L + dir * i * 0.002
    if (next < 0 || next > 1) break
    const hex = oklchToHex([next, C, h])
    if (ok(hex)) return { hex, moved: Math.abs(next - L) }
  }
  // Saturate at the extreme — the best this hue can do; the audit reports it.
  const edge = appearance === 'light' ? 0 : 1
  return { hex: oklchToHex([edge, C, h]), moved: Math.abs(edge - L) }
}

/**
 * Nearest lightness in *either* direction that satisfies a predicate. The
 * directional {@link fitAccent} is right when there is an obvious way to go — a
 * light skin darkens its accent — but the titlebar has no such bias: a mid
 * accent may reach a legible pairing faster by going up than down.
 * @param seed - OKLCh to start from.
 * @param ok - predicate on the candidate hex.
 * @returns the fitted colour and how far lightness travelled.
 */
function walkLightness(seed: Oklch, ok: (hex: string) => boolean): { hex: string; moved: number } {
  const [L, C, h] = seed
  if (ok(oklchToHex(seed))) return { hex: oklchToHex(seed), moved: 0 }
  for (let i = 1; i <= 500; i += 1) {
    for (const dir of [-1, 1]) {
      const next = L + dir * i * 0.002
      if (next < 0 || next > 1) continue
      const hex = oklchToHex([next, C, h])
      if (ok(hex)) return { hex, moved: i * 0.002 }
    }
  }
  /* v8 ignore next -- the band's predicate reads the ramp's own ends, and one
   * of them clears 4.5:1 against every lightness unless the ramp is inverted,
   * which deriveNeutral cannot produce; kept so the loop has a total result. */
  return { hex: oklchToHex(seed), moved: 0 }
}

/** Shift one colour's lightness by a fixed amount, holding hue and chroma. */
function shade(hex: string, delta: number): string {
  const [L, C, h] = hexToOklch(hex)
  return oklchToHex([Math.min(1, Math.max(0, L + delta)), C, h])
}

/** Blend two colours in OKLab, which keeps mid-points off the muddy sRGB path. */
function mix(a: string, b: string, t: number): string {
  const [aL, aC, aH] = hexToOklch(a)
  const [bL, bC, bH] = hexToOklch(b)
  return oklchToHex([lerp(aL, bL, t), lerp(aC, bC, t), lerpHue(aH, bH, t)])
}

/**
 * Derive the chrome layer's colour inputs. `_chrome.css` holds the structure —
 * radii, gradients, shadows, the three presets — and reads every colour from
 * these variables, so a skin's character comes out of its four seeds rather
 * than out of 380 hand-written literals.
 * @param theme - the skin's definition.
 * @param neutrals - the skin's generated neutral ramp.
 * @param brandPrimary - the fitted accent the semantic layer uses.
 * @returns variable name → CSS value.
 */
function deriveChrome(
  theme: SkinTheme, neutrals: Record<string, string>, brandPrimary: string,
): Record<string, string> {
  const { accent, secondary, surface } = theme.seeds
  const paper = required(neutrals['--dsw-static-neutral-bluish-00'], 'neutral-bluish-00')
  const ink = required(neutrals['--dsw-static-neutral-bluish-1000'], 'neutral-bluish-1000')

  // Which ramp end sits on a given fill. Chosen by the fill's own lightness
  // rather than by whichever scores higher: on a mid saturated blue the two are
  // within a tenth of a ratio point of each other, and maximising would put
  // black text on a QQ titlebar where every version of QQ used white. The band
  // moves instead if this choice does not clear the threshold.
  const pick = (hex: string): string => hexToOklch(hex)[0] < 0.62 ? paper : ink
  // A gradient's second stop always moves *away* from its own foreground, so a
  // band can only get more legible along its length and one validated stop
  // proves the whole thing. Moving toward the foreground instead is what
  // silently undoes an exact 4.5:1 fit — the first cut of this did exactly that.
  const away = (base: string, fg: string): string =>
    shade(base, luminance(fg) > luminance(base) ? -0.12 : 0.12)

  // The accent band: the titlebar and every primary control are the same solid
  // sweep of accent carrying a label, so they share one derivation.
  //
  // Unlike the semantic layer, the band paints the *raw* accent and then picks a
  // foreground to suit. Upstream pins one `label-primary-foreground` and shares
  // it between the primary button and the error banner, so there the accent is
  // the side that has to give way; here nothing else is watching, and keeping
  // the vivid seed is what stops a cyan skin rendering its signature control in
  // muted teal. Only when neither ramp end reads on the raw seed — a
  // mid-lightness red or blue — does the band's own lightness move, and then by
  // the smallest step that works.
  const band = walkLightness(hexToOklch(accent), hex => contrast(pick(hex), hex) >= 4.5)
  const bandInk = pick(band.hex)

  // How much of the photograph survives behind the transcript and behind the
  // frame. A dark skin hides a little more, because a bright photo bleeding
  // through dark chrome reads as glare rather than as texture. A custom skin
  // overrides this: its hero is whatever the user picked, so the wash is tuned
  // against that specific image instead of against an art-directed one.
  const veil = theme.veil ?? VEIL[theme.appearance]
  // Keep the frame's own wash proportional when a custom skin raises the veil,
  // so a hero that needs hiding gets hidden everywhere rather than only behind
  // the transcript.
  const veilSoft = Math.min(veil, VEIL_SOFT[theme.appearance] * (veil / VEIL[theme.appearance]))

  return {
    '--skin-accent': accent,
    // The accent with contrast guaranteed against the page: for hairline
    // outlines and focus rings, where the raw seed can vanish into the surface.
    '--skin-accent-strong': brandPrimary,
    '--skin-secondary': secondary,
    // Visible but quiet: input and button borders sit between accent and paper.
    '--skin-edge': mix(accent, paper, theme.appearance === 'light' ? 0.55 : 0.35),
    '--skin-band-from': band.hex,
    '--skin-band-to': away(band.hex, bandInk),
    '--skin-band-ink': bandInk,
    '--skin-band-edge': secondary,
    // Wash laid over the hero image so body text keeps its measured contrast.
    '--skin-surface': surface,
    '--skin-ink': ink,
    '--skin-veil': rgba(surface, round(veil)),
    '--skin-veil-soft': rgba(surface, round(veilSoft)),
    // The transcript stacks its wash on the frame's rather than repainting the
    // photograph, so it needs the alpha that composites to the same colour a
    // single `--skin-veil` pass would have produced. Solving
    // (1 - over)(1 - soft) = (1 - veil) for `over` is what keeps the audit
    // numbers honest: the surface body text sits on is bit-identical either way.
    '--skin-veil-over': rgba(surface, round(1 - (1 - veil) / (1 - veilSoft))),
  }
}

/** Four decimals is under one 8-bit step of alpha and keeps output diffable. */
const round = (value: number): number => Number(value.toFixed(4))

/**
 * Resolve one semantic token to a concrete colour, following `var()` chains
 * through the alias layer down to the skin's palette.
 * @param name - token to resolve.
 * @param aliases - semantic layer for the relevant scheme.
 * @param palette - the skin's derived palette.
 * @param seen - cycle guard, supplied by the recursion.
 * @returns hex colour, or null when the chain ends somewhere non-colour.
 */
export function resolveToken(
  name: string, aliases: Record<string, string>, palette: Record<string, string>,
  seen: Set<string> = new Set(),
): string | null {
  const direct = palette[name]
  if (direct !== undefined) return direct
  if (seen.has(name)) return null
  seen.add(name)
  const decl = aliases[name]
  if (decl === undefined) return null
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(decl)?.[1]
  if (ref !== undefined) return resolveToken(ref, aliases, palette, seen)
  try {
    // rgba() over an unknown backdrop is not a readability signal; skip it.
    if (/^rgba\(/i.test(decl)) return null
    return rgbToHex(parseColor(decl))
  } catch {
    return null
  }
}

/**
 * Derive one skin's whole colour surface from its seeds.
 * @param theme - the skin's definition.
 * @param stock - upstream's parsed palette and semantic layer.
 * @returns the palette, brand roles and chrome inputs.
 */
export function deriveSkin(theme: SkinTheme, stock: StockData): DerivedSkin {
  const seeds = {
    accent: hexToOklch(theme.seeds.accent),
    secondary: hexToOklch(theme.seeds.secondary),
    surface: hexToOklch(theme.seeds.surface),
    text: hexToOklch(theme.seeds.text),
  }
  const light = theme.appearance === 'light' ? seeds.surface : seeds.text
  const dark = theme.appearance === 'light' ? seeds.text : seeds.surface

  // The skin's background is its surface seed verbatim; the rest of the ramp is
  // solved against it, so nothing drifts away from what the theme declares.
  const backdrop = theme.seeds.surface
  const stockBg = required(stock.hex[BG_STEP[theme.appearance]], BG_STEP[theme.appearance])
  const neutrals = {
    ...deriveNeutral(family(stock, '--dsw-static-neutral-bluish'), stockBg, backdrop, light, dark, 1),
    ...deriveNeutral(family(stock, '--dsw-static-neutral'), stockBg, backdrop, light, dark, 0.35),
  }
  neutrals[BG_STEP[theme.appearance]] = backdrop

  const palette = {
    ...neutrals,
    // `deepseek` is upstream's accent family: chat bubbles, the active sidebar
    // item, info buttons. Those are fills and tints, so the ramp is anchored on
    // the raw seed — the readability thresholds belong to the roles below.
    ...deriveAccent(family(stock, '--dsw-static-deepseek'), '--dsw-static-deepseek-500', seeds.accent),
    // `blue` carries the second voice; only `label-primary-bluish` reads from it.
    ...deriveAccent(family(stock, '--dsw-static-blue'), '--dsw-static-blue-500', seeds.secondary),
    ...deriveAccent(family(stock, '--dsw-static-blue-50p'), '--dsw-static-blue-50p', seeds.secondary),
  }

  // Stock maps brand-primary onto near-black, so a skin that only overrides the
  // palette would lose its accent entirely at the semantic layer. Repoint the
  // brand roles by hand, each fitted to the threshold its usage demands.
  //
  // brand-primary is painted as outlines, focus rings and the primary button
  // fill, so it carries two constraints at once: visible against the page (3:1,
  // WCAG's UI-component threshold) and legible under the *stock* foreground
  // (4.5:1). Fitting the accent to the foreground rather than swapping the
  // foreground matters — `label-primary-foreground` is also the text on the
  // error banner, where the backdrop is the untouched semantic red.
  const foregroundToken = required(
    stock.aliases[theme.appearance]['--dsw-alias-label-primary-foreground'],
    '--dsw-alias-label-primary-foreground',
  ).replace(/^var\(\s*|\s*\)$/g, '')
  const foreground = required(neutrals[foregroundToken], foregroundToken)
  const outline = fitAccent(seeds.accent, theme.appearance, hex =>
    contrast(hex, backdrop) >= 3 && contrast(hex, foreground) >= 4.5)
  const brandText = fitAccent(seeds.accent, theme.appearance, hex => contrast(hex, backdrop) >= 4.5)
  const hoverStep = theme.appearance === 'light'
    ? '--dsw-static-deepseek-400'
    : '--dsw-static-deepseek-600'
  const brand = {
    '--dsw-alias-brand-primary': outline.hex,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': outline.hex,
    '--dsw-alias-brand-text': brandText.hex,
    '--dsw-alias-button-primary-hover': `var(${hoverStep})`,
  }

  return { palette, brand, chrome: deriveChrome(theme, neutrals, outline.hex), moved: outline.moved }
}

// ── readability contract ────────────────────────────────────────────────────

/** One audited foreground/background pair and the ratio it has to clear. */
export interface ContractPair {
  /** Human-readable role, shown in the generator's audit table. */
  label: string
  /** Foreground token or `--skin-*` variable. */
  fg: string
  /** Background token. */
  bg: string
  /** Minimum WCAG 2.1 contrast ratio. */
  min: number
}

/** A chrome pair, whose background is every gradient stop it can land on. */
export interface ChromeContractPair extends Omit<ContractPair, 'bg'> {
  /** The gradient stops the foreground is measured against, all of them. */
  bg: readonly string[]
}

/**
 * Readability contract, measured on the colours a skin actually paints: each
 * pair is resolved through upstream's own alias layer for the skin's scheme, so
 * the audit tracks whatever upstream currently maps these roles onto.
 */
export const CONTRACT: readonly ContractPair[] = [
  { label: '正文', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-bg-base', min: 4.5 },
  { label: '次要文字', fg: '--dsw-alias-label-secondary', bg: '--dsw-alias-bg-base', min: 4.5 },
  { label: '三级文字', fg: '--dsw-alias-label-tertiary', bg: '--dsw-alias-bg-base', min: 3 },
  { label: '强调文字', fg: '--dsw-alias-brand-text', bg: '--dsw-alias-bg-base', min: 4.5 },
  { label: '描边强调', fg: '--dsw-alias-brand-primary', bg: '--dsw-alias-bg-base', min: 3 },
  { label: '主按钮文字', fg: '--dsw-alias-label-primary-foreground', bg: '--dsw-alias-button-primary-fill', min: 4.5 },
  { label: '气泡文字', fg: '--dsw-alias-label-primary', bg: '--dsw-specific-bubble', min: 4.5 },
]

/**
 * The chrome layer paints its own surfaces, so its legibility cannot be read
 * off the alias graph; these pairs are measured on the emitted `--skin-*`
 * variables directly. Each foreground is checked against *every* gradient stop
 * it can land on, so a gradient cannot hide a failure at one end.
 */
export const CHROME_CONTRACT: readonly ChromeContractPair[] = [
  { label: '色带文字', fg: '--skin-band-ink', bg: ['--skin-band-from', '--skin-band-to'], min: 4.5 },
]

/** One audited pair's outcome. */
export interface AuditEntry {
  /** The role that was measured. */
  label: string
  /** Measured contrast ratio, or null when the pair does not resolve to colours. */
  ratio: number | null
  /** The threshold it had to clear. */
  min: number
  /** Whether it cleared. Unresolvable pairs count as passing; they paint nothing. */
  pass: boolean
}

/**
 * Measure a derived skin against the readability contract.
 * @param theme - the skin's definition.
 * @param derived - what {@link deriveSkin} produced for it.
 * @param stock - upstream's parsed palette and semantic layer.
 * @returns one entry per contract pair, in contract order.
 */
export function auditSkin(theme: SkinTheme, derived: DerivedSkin, stock: StockData): AuditEntry[] {
  // The skin's own brand declarations override upstream's for this audit, the
  // same way the cascade will apply them in the browser.
  const layer = { ...stock.aliases[theme.appearance], ...derived.brand }
  const out: AuditEntry[] = []
  for (const pair of CONTRACT) {
    const fg = resolveToken(pair.fg, layer, derived.palette)
    const bg = resolveToken(pair.bg, layer, derived.palette)
    if (fg === null || bg === null) {
      out.push({ label: pair.label, ratio: null, min: pair.min, pass: true })
      continue
    }
    const ratio = contrast(fg, bg)
    out.push({ label: pair.label, ratio, min: pair.min, pass: ratio >= pair.min })
  }
  for (const pair of CHROME_CONTRACT) {
    const fg = required(derived.chrome[pair.fg], pair.fg)
    const ratio = Math.min(...pair.bg.map(b => contrast(fg, required(derived.chrome[b], b))))
    out.push({ label: pair.label, ratio, min: pair.min, pass: ratio >= pair.min })
  }
  return out
}
