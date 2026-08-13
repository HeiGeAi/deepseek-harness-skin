/** Ramp derivation, chrome inputs, token resolution and the readability audit. */
import { describe, expect, it } from 'vitest'
import {
  auditSkin, BG_STEP, CONTRACT, deriveSkin, resolveToken, type SkinTheme,
} from '../src/skins/derive.ts'
import { composite, contrast, hexToOklch, parseColor } from '../src/skins/color.ts'
import type { StockData, StockStep } from '../src/skins/stock.ts'
import { STOCK } from '../src/styles/skins/generated/stock.ts'

const LIGHT: SkinTheme = {
  id: 'spec-light',
  appearance: 'light',
  chrome: 'glass',
  seeds: { accent: '#1a7f8c', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
}

const DARK: SkinTheme = {
  id: 'spec-dark',
  appearance: 'dark',
  chrome: 'neon',
  seeds: { accent: '#4dd0e1', secondary: '#e14d9c', surface: '#141419', text: '#ecebf0' },
}

/** Read one `rgba(r, g, b, a)` value's alpha. */
function alphaOf(value: string): number {
  const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(value)?.[1]
  if (alpha === undefined) throw new Error(`not an rgba value: ${value}`)
  return Number(alpha)
}

/** One synthetic palette step. */
function step(name: string, L: number, C: number, h: number): StockStep {
  return { name, L, C, h }
}

/**
 * A minimal well-formed stock: enough families, hexes and aliases for the
 * derivation to run, so a spec can bend one part of it without hand-writing
 * upstream's whole palette.
 * @returns the synthetic stock.
 */
function synthStock(): StockData {
  const bluish = [
    step('--dsw-static-neutral-bluish-00', 1, 0.001, 250),
    step('--dsw-static-neutral-bluish-400', 0.7, 0.008, 250),
    step('--dsw-static-neutral-bluish-950', 0.16, 0.01, 250),
    step('--dsw-static-neutral-bluish-1000', 0.1, 0.01, 250),
  ]
  return {
    families: {
      '--dsw-static-neutral-bluish': bluish,
      '--dsw-static-neutral': [
        step('--dsw-static-neutral-00', 1, 0, 0),
        step('--dsw-static-neutral-500', 0.6, 0, 0),
        step('--dsw-static-neutral-1000', 0.12, 0, 0),
      ],
      '--dsw-static-deepseek': [
        step('--dsw-static-deepseek-300', 0.8, 0.09, 260),
        step('--dsw-static-deepseek-500', 0.6, 0.15, 260),
        step('--dsw-static-deepseek-700', 0.4, 0.11, 260),
      ],
      '--dsw-static-blue': [
        step('--dsw-static-blue-300', 0.82, 0.08, 240),
        step('--dsw-static-blue-500', 0.62, 0.14, 240),
      ],
      '--dsw-static-blue-50p': [step('--dsw-static-blue-50p', 0.95, 0.03, 240)],
    },
    hex: {
      '--dsw-static-neutral-bluish-00': '#ffffff',
      '--dsw-static-neutral-bluish-950': '#1c1c22',
    },
    aliases: {
      light: { '--dsw-alias-label-primary-foreground': 'var(--dsw-static-neutral-bluish-00)' },
      dark: { '--dsw-alias-label-primary-foreground': 'var(--dsw-static-neutral-bluish-00)' },
    },
  }
}

describe('deriveSkin against upstream stock', () => {
  it('pins the page background on the surface seed verbatim', () => {
    expect(deriveSkin(LIGHT, STOCK).palette[BG_STEP.light]).toBe(LIGHT.seeds.surface)
    expect(deriveSkin(DARK, STOCK).palette[BG_STEP.dark]).toBe(DARK.seeds.surface)
  })

  it('clears every readability contract for both schemes', () => {
    for (const theme of [LIGHT, DARK]) {
      const entries = auditSkin(theme, deriveSkin(theme, STOCK), STOCK)
      expect(entries).toHaveLength(CONTRACT.length + 1)
      expect(entries.filter(entry => !entry.pass)).toEqual([])
    }
  })

  it('keeps the neutral ramp ordered from the light end to the dark end', () => {
    const { palette } = deriveSkin(LIGHT, STOCK)
    const bluish = STOCK.families['--dsw-static-neutral-bluish'] ?? []
    const lightness = bluish.map(s => hexToOklch(palette[s.name] ?? '#000000')[0])
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]).toBeLessThanOrEqual((lightness[i - 1] ?? 0) + 1e-9)
    }
  })

  it('paints the band with a foreground that reads on it', () => {
    for (const theme of [LIGHT, DARK]) {
      const { chrome } = deriveSkin(theme, STOCK)
      const ink = chrome['--skin-band-ink'] ?? ''
      expect(contrast(ink, chrome['--skin-band-from'] ?? '')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(ink, chrome['--skin-band-to'] ?? '')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('stacks the transcript wash onto the frame wash without changing the result', () => {
    // The transcript paints `--skin-veil-over` on top of `--skin-veil-soft`
    // rather than repainting the photograph, so the two-pass composite has to
    // land on the same colour a single `--skin-veil` pass would produce.
    const { chrome } = deriveSkin(DARK, STOCK)
    const surface = DARK.seeds.surface
    const photo = '#c0d8ff'
    // Compared per channel because this path quantises to 8 bits twice and the
    // single pass only once, which can leave one channel a step apart.
    const soft = composite(surface, alphaOf(chrome['--skin-veil-soft'] ?? ''), photo)
    const stacked = parseColor(composite(surface, alphaOf(chrome['--skin-veil-over'] ?? ''), soft))
    const once = parseColor(composite(surface, alphaOf(chrome['--skin-veil'] ?? ''), photo))
    for (const [i, channel] of stacked.entries()) {
      expect(Math.abs(channel - (once[i] ?? 0))).toBeLessThanOrEqual(1)
    }
  })

  it('takes a tuned veil over the per-appearance default', () => {
    const plain = deriveSkin(DARK, STOCK).chrome['--skin-veil'] ?? ''
    const tuned = deriveSkin({ ...DARK, veil: 0.94 }, STOCK).chrome['--skin-veil'] ?? ''
    expect(alphaOf(plain)).toBeCloseTo(0.86, 6)
    expect(alphaOf(tuned)).toBeCloseTo(0.94, 6)
    // The frame's wash rises with it rather than staying at its default.
    expect(alphaOf(deriveSkin({ ...DARK, veil: 0.94 }, STOCK).chrome['--skin-veil-soft'] ?? ''))
      .toBeGreaterThan(alphaOf(deriveSkin(DARK, STOCK).chrome['--skin-veil-soft'] ?? ''))
  })

  it('brightens a dark skin accent rather than darkening it', () => {
    const dim: SkinTheme = { ...DARK, id: 'spec-dim', seeds: { ...DARK.seeds, accent: '#0a1420' } }
    const derived = deriveSkin(dim, STOCK)
    expect(derived.moved).toBeGreaterThan(0)
    expect(hexToOklch(derived.brand['--dsw-alias-brand-primary'] ?? '')[0])
      .toBeGreaterThan(hexToOklch(dim.seeds.accent)[0])
  })

  it('saturates a dark skin at the light end when brightening cannot help', () => {
    // A dark skin on a white page: brightening the accent walks it toward the
    // backdrop, so the 3:1 never arrives and the fit stops at the ramp's top.
    const inverted: SkinTheme = {
      id: 'spec-inverted',
      appearance: 'dark',
      chrome: 'flat',
      seeds: { accent: '#f2f2f4', secondary: '#e8e8ee', surface: '#ffffff', text: '#000000' },
    }
    expect(deriveSkin(inverted, STOCK).brand['--dsw-alias-brand-primary']).toBe('#ffffff')
  })

  it('saturates the accent fit when no lightness can reach the threshold', () => {
    // A light skin whose surface is black: the fit darkens the accent looking
    // for 3:1 against the page, and every darker step moves it closer to the
    // backdrop instead. It runs out of range and reports the edge.
    const trapped: SkinTheme = {
      id: 'spec-trapped',
      appearance: 'light',
      chrome: 'flat',
      seeds: { accent: '#101012', secondary: '#202024', surface: '#000000', text: '#ffffff' },
    }
    const derived = deriveSkin(trapped, STOCK)
    expect(derived.brand['--dsw-alias-brand-primary']).toBe('#000000')
    expect(derived.moved).toBeGreaterThan(0)
    // And the audit says so rather than pretending it worked.
    expect(auditSkin(trapped, derived, STOCK).some(entry => !entry.pass)).toBe(true)
  })
})

describe('deriveSkin against a bent stock', () => {
  it('names the family it cannot find', () => {
    const stock = synthStock()
    delete stock.families['--dsw-static-deepseek']
    expect(() => deriveSkin(LIGHT, stock)).toThrow(/missing --dsw-static-deepseek/)
  })

  it('names the background step it cannot find', () => {
    const stock = synthStock()
    stock.hex = Object.fromEntries(Object.entries(stock.hex).filter(([step]) => step !== BG_STEP.light))
    expect(() => deriveSkin(LIGHT, stock)).toThrow(/missing --dsw-static-neutral-bluish-00/)
  })

  it('falls back to the middle step when the accent anchor is missing', () => {
    const stock = synthStock()
    stock.families['--dsw-static-deepseek'] = [
      step('--dsw-static-deepseek-300', 0.8, 0.09, 260),
      step('--dsw-static-deepseek-450', 0.6, 0.15, 260),
      step('--dsw-static-deepseek-700', 0.4, 0.11, 260),
    ]
    const { palette } = deriveSkin(LIGHT, stock)
    // The middle step took the anchor's place, so it landed on the seed.
    expect(palette['--dsw-static-deepseek-450']).toBe(LIGHT.seeds.accent)
  })

  it('keeps the stock chroma silhouette when the anchor is achromatic', () => {
    const stock = synthStock()
    stock.families['--dsw-static-deepseek'] = [
      step('--dsw-static-deepseek-500', 0.6, 0, 0),
      step('--dsw-static-deepseek-700', 0.4, 0, 0),
    ]
    // chromaScale falls back to 1, so a zero-chroma family stays grey.
    expect(hexToOklch(deriveSkin(LIGHT, stock).palette['--dsw-static-deepseek-700'] ?? '')[1])
      .toBeLessThan(0.001)
  })

  it('collapses a ramp whose steps are a rounding step apart', () => {
    const stock = synthStock()
    // Two steps below the anchor by less than the span guard: there is a
    // darker step to place, and no span worth interpolating across.
    stock.families['--dsw-static-deepseek'] = [
      step('--dsw-static-deepseek-500', 0.6, 0.15, 260),
      step('--dsw-static-deepseek-700', 0.6 - 1e-9, 0.15, 260),
    ]
    const { palette } = deriveSkin(LIGHT, stock)
    expect(palette['--dsw-static-deepseek-700']).toBe(LIGHT.seeds.accent)
  })

  it('collapses a one-step ramp onto the seed', () => {
    const stock = synthStock()
    stock.families['--dsw-static-blue'] = [step('--dsw-static-blue-500', 0.62, 0.14, 240)]
    stock.families['--dsw-static-neutral'] = [step('--dsw-static-neutral-500', 0.6, 0, 0)]
    const { palette } = deriveSkin(LIGHT, stock)
    expect(palette['--dsw-static-blue-500']).toBe(LIGHT.seeds.secondary)
    // A neutral family with one step has no span to interpolate across, so the
    // step reproduces its own stock contrast and nothing more.
    expect(palette['--dsw-static-neutral-500']).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('names the foreground token it cannot resolve', () => {
    const stock = synthStock()
    stock.aliases.light['--dsw-alias-label-primary-foreground'] = 'var(--dsw-static-nope)'
    expect(() => deriveSkin(LIGHT, stock)).toThrow(/missing --dsw-static-nope/)
  })
})

describe('resolveToken', () => {
  const palette = { '--dsw-static-x': '#123456' }

  it('reads a palette step directly', () => {
    expect(resolveToken('--dsw-static-x', {}, palette)).toBe('#123456')
  })

  it('follows a var() chain down to a step', () => {
    const aliases = { '--a': 'var(--b)', '--b': 'var(--dsw-static-x)' }
    expect(resolveToken('--a', aliases, palette)).toBe('#123456')
  })

  it('gives up on a cycle instead of recursing forever', () => {
    expect(resolveToken('--a', { '--a': 'var(--b)', '--b': 'var(--a)' }, palette)).toBeNull()
  })

  it('gives up when the chain ends nowhere', () => {
    expect(resolveToken('--gone', {}, palette)).toBeNull()
  })

  it('reads a literal colour declaration', () => {
    expect(resolveToken('--a', { '--a': 'rgb(18, 52, 86)' }, palette)).toBe('#123456')
  })

  it('skips a translucent declaration, whose backdrop is unknown', () => {
    expect(resolveToken('--a', { '--a': 'rgba(0, 0, 0, 0.4)' }, palette)).toBeNull()
  })

  it('gives up on a declaration that is not a colour at all', () => {
    expect(resolveToken('--a', { '--a': '1px solid currentColor' }, palette)).toBeNull()
  })
})

describe('auditSkin', () => {
  it('passes a pair that resolves to nothing, because it paints nothing', () => {
    const derived = deriveSkin(LIGHT, STOCK)
    const blind: StockData = { ...STOCK, aliases: { light: {}, dark: {} } }
    const entries = auditSkin(LIGHT, derived, blind)
    const unresolved = entries.filter(entry => entry.ratio === null)
    expect(unresolved.length).toBeGreaterThan(0)
    expect(unresolved.every(entry => entry.pass)).toBe(true)
  })

  it('measures the chrome band against every gradient stop', () => {
    const derived = deriveSkin(LIGHT, STOCK)
    const band = auditSkin(LIGHT, derived, STOCK).at(-1)
    expect(band?.label).toBe('色带文字')
    const stops = ['--skin-band-from', '--skin-band-to']
      .map(name => contrast(derived.chrome['--skin-band-ink'] ?? '', derived.chrome[name] ?? ''))
    expect(band?.ratio).toBeCloseTo(Math.min(...stops), 10)
  })
})
