/** Skin CSS formatting, and the custom skin's trip from settings to rules. */
import { describe, expect, it } from 'vitest'
import { deriveSkin, type SkinTheme } from '../src/skins/derive.ts'
import { renderSkinCss } from '../src/skins/render.ts'
import {
  customSkinCss, customSkinTheme, skinImageUrl, SKIN_IMAGE_ROUTE,
} from '../src/skins/custom.ts'
import { STOCK } from '../src/styles/skins/generated/stock.ts'
import { CUSTOM_SKIN, EMPTY_CUSTOM_SKIN, type CustomSkin } from '../src/theme-settings.ts'

const BARE: SkinTheme = {
  id: 'bare',
  appearance: 'light',
  chrome: 'flat',
  seeds: { accent: '#1a7f8c', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
}

const DRESSED: SkinTheme = {
  ...BARE,
  id: 'dressed',
  hero: 'hero.webp',
  heroFocus: '30% 70%',
  glyph: '🐟',
  showBadge: true,
  font: '"SimSun", serif',
}

const CUSTOM: CustomSkin = {
  image: 'a b.webp',
  appearance: 'dark',
  chrome: 'neon',
  veil: 0.9,
  focus: '20% 40%',
  seeds: { accent: '#4dd0e1', secondary: '#e14d9c', surface: '#141419', text: '#ecebf0' },
}

/** Render one theme against upstream stock. */
function render(theme: SkinTheme): string {
  return renderSkinCss(theme, deriveSkin(theme, STOCK), hero => `url("./${hero}")`)
}

describe('renderSkinCss', () => {
  it('scopes the chrome block to the active body and to the preview swatch', () => {
    const css = render(BARE)
    expect(css).toContain("body[data-dsh-skin='bare'],\n[data-skin-preview='bare'] {")
    expect(css).toContain('  --skin-accent: #1a7f8c;')
    expect(css.endsWith('\n')).toBe(true)
  })

  it('records the seeds it was built from', () => {
    expect(render(BARE)).toContain('/* seeds: accent #1a7f8c · secondary #8c5a1a')
  })

  it('leaves out what a bare skin does not declare', () => {
    const css = render(BARE)
    expect(css).not.toContain('--skin-hero')
    expect(css).not.toContain('--skin-glyph')
    expect(css).not.toContain('--skin-badge')
    expect(css).not.toContain('--dsw-font-family')
  })

  it('emits hero, glyph, badge and font when the skin declares them', () => {
    const css = render(DRESSED)
    expect(css).toContain('  --skin-hero: url("./hero.webp");')
    expect(css).toContain('  --skin-hero-focus: 30% 70%;')
    expect(css).toContain("  --skin-glyph: '🐟';")
    expect(css).toContain('  --skin-badge: inline-block;')
    expect(css).toContain('  --dsw-font-family: "SimSun", serif;')
  })

  it('centres a hero that names no focus', () => {
    const { heroFocus: _drop, ...centred } = DRESSED
    expect(render(centred)).toContain('  --skin-hero-focus: 50% 50%;')
  })

  it('sorts the palette and brand blocks so the generated files stay diffable', () => {
    const names = [...render(BARE).matchAll(/^ {2}(--dsw-static-[a-z0-9-]+):/gm)].map(m => m[1] ?? '')
    expect(names).toEqual([...names].sort())
  })
})

describe('the custom skin', () => {
  it('serves an image under the Host route with its name escaped', () => {
    expect(skinImageUrl('a b.webp')).toBe(`${SKIN_IMAGE_ROUTE}/a%20b.webp`)
  })

  it('widens persisted settings into the theme the derivation consumes', () => {
    expect(customSkinTheme(CUSTOM)).toEqual({
      id: CUSTOM_SKIN,
      appearance: 'dark',
      chrome: 'neon',
      seeds: CUSTOM.seeds,
      veil: 0.9,
      hero: 'a b.webp',
      heroFocus: '20% 40%',
    })
  })

  it('renders rules that point at the stored image and carry the tuned veil', () => {
    const css = customSkinCss(CUSTOM)
    expect(css).toContain(`--skin-hero: url("${SKIN_IMAGE_ROUTE}/a%20b.webp")`)
    expect(css).toContain('--skin-hero-focus: 20% 40%;')
    expect(css).toContain('rgba(20, 20, 25, 0.9)')
    expect(css).toContain("body[data-dsh-skin='custom']")
  })

  it('produces the same rules the built-in pipeline would for the same theme', () => {
    const theme = customSkinTheme(CUSTOM)
    const direct = renderSkinCss(
      theme, deriveSkin(theme, STOCK), image => `url("${skinImageUrl(image)}")`,
    )
    expect(customSkinCss(CUSTOM)).toBe(direct)
  })

  it('still renders when no image has been picked yet', () => {
    // The empty skin has no hero, so the rules carry colours and nothing else.
    const css = customSkinCss(EMPTY_CUSTOM_SKIN)
    expect(css).not.toContain('--skin-hero')
    expect(css).toContain("body[data-dsh-skin='custom']")
  })
})
