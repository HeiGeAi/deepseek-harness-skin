/** OKLab/OKLCh conversion chain, gamut fitting and the contrast helpers. */
import { describe, expect, it } from 'vitest'
import {
  composite, contrast, fitGamut, hexToLinear, hexToOklch, linearToHex, linearToOklab, luminance,
  oklabToLinear, oklabToOklch, oklchToHex, oklchToOklab, parseColor, rgba, rgbToHex,
} from '../src/skins/color.ts'

describe('parseColor', () => {
  it('reads the three notations design tokens are written in', () => {
    expect(parseColor('#4d6bfe')).toEqual([77, 107, 254])
    expect(parseColor('#abc')).toEqual([170, 187, 204])
    expect(parseColor('rgb(20, 30, 40)')).toEqual([20, 30, 40])
    expect(parseColor('rgba(20 30 40 / 0.5)')).toEqual([20, 30, 40])
  })

  it('rounds and clamps channels rather than emitting an impossible colour', () => {
    expect(parseColor('rgb(300, 40.4, 12.6)')).toEqual([255, 40, 13])
  })

  it('rejects anything that is not a colour', () => {
    expect(() => parseColor('cornflower')).toThrow(/bad color/)
    expect(() => parseColor('#12345')).toThrow(/bad color/)
  })
})

describe('conversion chain', () => {
  it('round-trips hex through every representation', () => {
    for (const hex of ['#000000', '#ffffff', '#4d6bfe', '#e8b540', '#201f22']) {
      expect(linearToHex(hexToLinear(hex))).toBe(hex)
      expect(oklchToHex(hexToOklch(hex))).toBe(hex)
      const lab = linearToOklab(hexToLinear(hex))
      expect(linearToHex(oklabToLinear(lab))).toBe(hex)
      expect(oklchToOklab(oklabToOklch(lab))[0]).toBeCloseTo(lab[0], 10)
    }
  })

  it('formats 8-bit triples with padding', () => {
    expect(rgbToHex([0, 8, 255])).toBe('#0008ff')
  })

  it('keeps hue meaningful for greys', () => {
    const [, C, h] = hexToOklch('#808080')
    expect(C).toBeLessThan(0.001)
    expect(Number.isFinite(h)).toBe(true)
  })
})

describe('fitGamut', () => {
  it('leaves an in-gamut colour alone', () => {
    const inside = hexToOklch('#4d6bfe')
    expect(linearToHex(fitGamut(inside))).toBe('#4d6bfe')
  })

  it('pulls chroma back until an out-of-gamut request renders', () => {
    // Nothing at this lightness can hold that much chroma; the fit has to give
    // up chroma rather than emit channels outside 0..1.
    // The fit bisects on chroma, so it lands just inside the boundary rather
    // than exactly on it; the tolerance is that search's resolution.
    const fitted = fitGamut([0.5, 0.6, 29])
    for (const channel of fitted) {
      expect(channel).toBeGreaterThanOrEqual(-1e-3)
      expect(channel).toBeLessThanOrEqual(1 + 1e-3)
    }
    expect(linearToHex(fitted)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('handles the achromatic extremes', () => {
    expect(linearToHex(fitGamut([0, 0, 0]))).toBe('#000000')
    expect(linearToHex(fitGamut([1, 0, 0]))).toBe('#ffffff')
  })
})

describe('contrast helpers', () => {
  it('reproduces the known WCAG anchors', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6)
    expect(luminance('#000000')).toBeCloseTo(0, 6)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 4)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 4)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 6)
  })

  it('formats an alpha layer as rgba', () => {
    expect(rgba('#4d6bfe', 0.5)).toBe('rgba(77, 107, 254, 0.5)')
  })

  it('composites a translucent layer onto its backdrop', () => {
    expect(composite('#ffffff', 0, '#201f22')).toBe('#201f22')
    expect(composite('#ffffff', 1, '#201f22')).toBe('#ffffff')
    expect(composite('#000000', 0.5, '#ffffff')).toBe('#808080')
  })
})
