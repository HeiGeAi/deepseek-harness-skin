/** Reading a skin out of a photograph, and tuning its wash until text reads. */
import { describe, expect, it } from 'vitest'
import { extractPalette, tuneCustomSkin, type ExtractedPalette } from '../src/skins/extract.ts'
import { hexToOklch, parseColor } from '../src/skins/color.ts'
import type { StockData } from '../src/skins/stock.ts'
import { STOCK } from '../src/styles/skins/generated/stock.ts'

/** One block of an imaginary photograph: a colour and how many pixels it covers. */
interface Block {
  /** The colour, as hex or `#rrggbbaa`. */
  hex: string
  /** How many pixels carry it. */
  count: number
}

/**
 * Build an RGBA buffer out of colour blocks.
 * @param blocks - the colours and their pixel counts.
 * @param trailing - stray bytes appended after the last whole pixel.
 * @returns the buffer, in the layout a canvas would hand over.
 */
function image(blocks: readonly Block[], trailing = 0): Uint8ClampedArray {
  const total = blocks.reduce((sum, block) => sum + block.count, 0)
  const out = new Uint8ClampedArray(total * 4 + trailing)
  let at = 0
  for (const block of blocks) {
    const [r, g, b] = parseColor(block.hex.slice(0, 7))
    const alpha = block.hex.length === 9 ? Number.parseInt(block.hex.slice(7), 16) : 255
    for (let i = 0; i < block.count; i += 1) {
      out[at] = r
      out[at + 1] = g
      out[at + 2] = b
      out[at + 3] = alpha
      at += 4
    }
  }
  return out
}

/** A photograph with no colour big enough to clear the area floor. */
function gradient(): Uint8ClampedArray {
  const blocks: Block[] = []
  for (let i = 0; i < 300; i += 1) {
    const r = (i % 10) * 25
    const g = (Math.floor(i / 10) % 10) * 25
    const b = Math.floor(i / 100) * 80
    blocks.push({ hex: `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`, count: 1 })
  }
  return image(blocks)
}

describe('extractPalette', () => {
  it('reads a light scheme off a bright picture and keeps its hue', () => {
    const { seeds, appearance, chrome } = extractPalette(image([
      { hex: '#f6f0e4', count: 700 },
      { hex: '#c8873a', count: 200 },
      { hex: '#3a6ec8', count: 100 },
    ]))
    expect(appearance).toBe('light')
    expect(chrome).toBe('glass')
    // Surface takes the dominant colour's hue, pushed light and desaturated.
    expect(hexToOklch(seeds.surface)[0]).toBeGreaterThan(0.9)
    expect(hexToOklch(seeds.surface)[1]).toBeLessThanOrEqual(0.03)
    // Accent is the saturated colour with real area, not the dominant wash.
    expect(hexToOklch(seeds.accent)[1]).toBeGreaterThan(0.06)
    // The second hue is far enough away to read as a different colour.
    const gap = Math.abs(((hexToOklch(seeds.secondary)[2] - hexToOklch(seeds.accent)[2] + 540) % 360) - 180)
    expect(gap).toBeGreaterThan(25)
  })

  it('reads a dark scheme off a night picture', () => {
    const { seeds, appearance, chrome } = extractPalette(image([
      { hex: '#141018', count: 800 },
      { hex: '#7a3fd0', count: 200 },
    ]))
    expect(appearance).toBe('dark')
    expect(chrome).toBe('neon')
    expect(hexToOklch(seeds.surface)[0]).toBeLessThanOrEqual(0.24)
    expect(hexToOklch(seeds.text)[0]).toBeCloseTo(0.93, 2)
  })

  it('invents a neighbouring hue when the picture tells one colour story', () => {
    const { seeds } = extractPalette(image([
      { hex: '#f2ece0', count: 700 },
      { hex: '#c8873a', count: 300 },
    ]))
    const gap = ((hexToOklch(seeds.secondary)[2] - hexToOklch(seeds.accent)[2] + 360) % 360)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(40)
  })

  it('falls back to the dominant colour when nothing sits in the accent band', () => {
    // Pure black and pure white only: neither is a usable accent lightness, so
    // the accent is built from the colour the picture mostly is.
    const { seeds } = extractPalette(image([
      { hex: '#000000', count: 600 },
      { hex: '#ffffff', count: 400 },
    ]))
    expect(seeds.accent).toMatch(/^#[0-9a-f]{6}$/)
    // Nothing chromatic to take a chroma from, so it lands on the floor.
    expect(hexToOklch(seeds.accent)[1]).toBeCloseTo(0.06, 2)
  })

  it('samples the heaviest buckets when a gradient clears no area floor', () => {
    const { seeds, extremes } = extractPalette(gradient())
    expect(seeds.surface).toMatch(/^#[0-9a-f]{6}$/)
    expect(extremes).toHaveLength(2)
  })

  it('brackets the picture with its darkest and brightest colours', () => {
    const { extremes } = extractPalette(image([
      { hex: '#808080', count: 500 },
      { hex: '#101010', count: 300 },
      { hex: '#f0f0f0', count: 200 },
    ]))
    expect(extremes[0]).toBe('#101010')
    expect(extremes[1]).toBe('#f0f0f0')
  })

  it('ignores transparent pixels and a truncated trailing pixel', () => {
    const opaque = extractPalette(image([{ hex: '#c8873a', count: 400 }]))
    const padded = extractPalette(image([
      { hex: '#c8873a', count: 400 },
      { hex: '#00ff0004', count: 200 },
    ], 3))
    expect(padded).toEqual(opaque)
  })

  it('refuses a picture with nothing opaque in it', () => {
    expect(() => extractPalette(image([{ hex: '#00000000', count: 40 }])))
      .toThrow(/no opaque pixels/)
  })
})

describe('tuneCustomSkin', () => {
  /** A palette that would come off a plausible photograph. */
  const readable: ExtractedPalette = {
    seeds: { accent: '#1a7f8c', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
    appearance: 'light',
    chrome: 'glass',
    extremes: ['#d8d2c6', '#faf7f0'],
  }

  it('settles on the default wash when the picture does not fight the text', () => {
    const tuned = tuneCustomSkin(readable, STOCK)
    expect(tuned.pass).toBe(true)
    expect(tuned.theme.veil).toBeCloseTo(0.82, 6)
    expect(tuned.theme.id).toBe('custom')
    expect(tuned.composited).toHaveLength(3)
  })

  it('starts a dark skin at a heavier wash than a light one', () => {
    // A dark surface has less headroom before a bright patch of photograph
    // washes the text out, so the search starts further along.
    const dark: ExtractedPalette = {
      seeds: { accent: '#4dd0e1', secondary: '#e14d9c', surface: '#141419', text: '#ecebf0' },
      appearance: 'dark',
      chrome: 'neon',
      extremes: ['#1b1b22', '#2e2e3a'],
    }
    const tuned = tuneCustomSkin(dark, STOCK)
    expect(tuned.theme.appearance).toBe('dark')
    expect(tuned.theme.veil).toBeCloseTo(0.86, 6)
    expect(tuned.pass).toBe(true)
  })

  it('raises the wash until a punishing picture stops eating the contrast', () => {
    // A wide-open image behind a light skin: at the default wash the bright end
    // pushes the composite up and the tertiary label loses its 3:1.
    const harsh: ExtractedPalette = { ...readable, extremes: ['#000000', '#ffffff'] }
    const tuned = tuneCustomSkin(harsh, STOCK)
    expect(tuned.theme.veil ?? 0).toBeGreaterThan(0.82)
    expect(tuned.pass).toBe(true)
    expect(tuned.composited.every(entry => entry.pass)).toBe(true)
  })

  it('stops at the ceiling and reports the failure when the seeds are the problem', () => {
    // A dark surface declared as a light scheme: the ramp solves every step in
    // the wrong direction and body text lands near 1.4:1 on the bare surface.
    // Hiding the photograph completely cannot fix that, so the search runs to
    // the top and says so rather than claiming success.
    const doomed: ExtractedPalette = {
      seeds: { accent: '#8a8a8a', secondary: '#909090', surface: '#242424', text: '#f0f0f0' },
      appearance: 'light',
      chrome: 'flat',
      extremes: ['#000000', '#ffffff'],
    }
    const tuned = tuneCustomSkin(doomed, STOCK)
    expect(tuned.theme.veil).toBeCloseTo(0.98, 6)
    expect(tuned.pass).toBe(false)
  })

  it('passes a role whose alias chain leads nowhere, because it paints nothing', () => {
    // The derivation still needs the button foreground; the three text roles
    // are the ones cut away.
    const kept = { '--dsw-alias-label-primary-foreground': STOCK.aliases.light['--dsw-alias-label-primary-foreground'] ?? '' }
    const blind: StockData = { ...STOCK, aliases: { light: kept, dark: kept } }
    const tuned = tuneCustomSkin(readable, blind)
    expect(tuned.composited).toHaveLength(3)
    expect(tuned.composited.every(entry => entry.ratio === null && entry.pass)).toBe(true)
  })

  it('reports a composited ratio no better than the bare surface managed', () => {
    // Letting a picture through can only cost contrast, never add it, so the
    // composited number is the honest one and the bare audit is the ceiling.
    const tuned = tuneCustomSkin(readable, STOCK)
    const body = tuned.composited.find(entry => entry.label === '正文')?.ratio ?? 0
    const bare = tuned.audit.find(entry => entry.label === '正文')?.ratio ?? 0
    expect(body).toBeGreaterThanOrEqual(4.5)
    expect(body).toBeLessThanOrEqual(bare)
  })
})
