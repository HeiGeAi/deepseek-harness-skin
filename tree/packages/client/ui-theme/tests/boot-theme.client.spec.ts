// @vitest-environment jsdom
/** Host index injection and the resulting pre-plugin browser theme. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { injectBootTheme } from '../src/boot-theme.ts'
import { customSkinCss, CUSTOM_SKIN_STYLE_ID } from '../src/skins/custom.ts'
import { EMPTY_CUSTOM_SKIN } from '../src/theme-settings.ts'
import type { CustomSkin, SkinId, ThemePreference } from '../src/theme-settings.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'
const SKIN_ATTRIBUTE = 'data-dsh-skin'
const CHROME_ATTRIBUTE = 'data-skin-chrome'

function mockSystemDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
}

function executeBootstrap(
  preference?: ThemePreference,
  html = '<html><body><div id="root"></div><script type="module"></script></body></html>',
  skin: SkinId = 'none',
): string {
  const injected = injectBootTheme(html, preference, skin)
  const source = /<script>([\s\S]*?)<\/script>/.exec(injected)?.[1]
  if (source === undefined) throw new Error('theme bootstrap script missing')
  runInNewContext(source, { document, matchMedia: globalThis.matchMedia })
  return injected
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute(SKIN_ATTRIBUTE)
  document.body.removeAttribute(CHROME_ATTRIBUTE)
})

describe('theme boot index transform', () => {
  it('runs immediately inside the body before the shell mount', () => {
    mockSystemDark(false)
    const html = executeBootstrap('dark', '<html><body class="app"><div id="root"></div></body></html>')
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<body class="app">'))
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<div id="root">'))
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
  })

  it('lets durable light override a dark OS and clears stale dark state', () => {
    document.body.setAttribute(DARK_ATTRIBUTE, '')
    mockSystemDark(true)
    executeBootstrap('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it.each([
    [true, 'dark', true],
    [false, 'light', false],
  ] as const)('resolves system=%s to %s', (matches, colorScheme, dark) => {
    mockSystemDark(matches)
    executeBootstrap('system')
    expect(document.documentElement.style.colorScheme).toBe(colorScheme)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(dark)
  })

  it('defaults to system and falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    executeBootstrap()
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it('appends the script to a body-less fragment', () => {
    const html = injectBootTheme('<main>loading</main>', 'dark')
    expect(html.startsWith('<main>loading</main><script>')).toBe(true)
  })

  it('a QQ-era skin pins the light scheme and stamps the skin attribute', () => {
    mockSystemDark(true)
    executeBootstrap('dark', '<html><body></body></html>', 'qq-2008')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.getAttribute(SKIN_ATTRIBUTE)).toBe('qq-2008')
  })

  it('a dark skin pins the dark scheme against a light preference', () => {
    mockSystemDark(false)
    executeBootstrap('light', '<html><body></body></html>', 'waves-1')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(document.body.getAttribute(SKIN_ATTRIBUTE)).toBe('waves-1')
  })

  it('stamps the chrome preset alongside the skin, and clears both for none', () => {
    executeBootstrap('light', '<html><body></body></html>', 'qq-2007')
    expect(document.body.getAttribute(CHROME_ATTRIBUTE)).toBe('flat')
    executeBootstrap('light', '<html><body></body></html>', 'none')
    expect(document.body.hasAttribute(CHROME_ATTRIBUTE)).toBe(false)
  })

  it('the none skin never stamps the skin attribute', () => {
    mockSystemDark(true)
    executeBootstrap('dark', '<html><body></body></html>', 'none')
    expect(document.body.hasAttribute(SKIN_ATTRIBUTE)).toBe(false)
  })

  it('inlines the custom skin rules so they exist before first paint', () => {
    // Built-in skins ship their rules in the bundle; the custom skin's are a
    // function of the settings document, so the boot response has to carry them
    // or the first frame paints the wrong skin.
    const custom: CustomSkin = {
      ...EMPTY_CUSTOM_SKIN,
      image: 'skin-00000000000000000000000000000000.webp',
      appearance: 'dark',
      chrome: 'neon',
    }
    const html = injectBootTheme('<html><body></body></html>', 'light', 'custom', custom)
    expect(html).toContain(`<style id="${CUSTOM_SKIN_STYLE_ID}">`)
    expect(html).toContain(customSkinCss(custom))
    // The style tag precedes the script, so the rules are in the document
    // before the attribute that selects them is written.
    expect(html.indexOf('<style')).toBeLessThan(html.indexOf('<script>'))
    expect(html).toContain("setAttribute('data-dsh-skin', \"custom\")")
    expect(html).toContain("setAttribute('data-skin-chrome', \"neon\")")
  })

  it('emits no stylesheet until the user has made a custom skin', () => {
    const html = injectBootTheme('<html><body></body></html>', 'light', 'custom', EMPTY_CUSTOM_SKIN)
    expect(html).not.toContain('<style')
    // With nothing behind it the selected id pins nothing, so the preference wins.
    expect(html).toContain("removeAttribute('data-dsh-skin')")
  })

  it('cannot be talked into closing its own style element', () => {
    // Every field reaching the CSS passes the upload route's checks, so this is
    // belt-and-braces: a hostile focus string still cannot end the tag early.
    const custom: CustomSkin = {
      ...EMPTY_CUSTOM_SKIN,
      image: 'skin-00000000000000000000000000000000.webp',
      focus: '50% 50%</style><script>alert(1)</script>',
    }
    const html = injectBootTheme('<html><body></body></html>', 'light', 'custom', custom)
    expect(html).not.toContain('</style><script>alert(1)')
    expect(html).toContain('<\\/style>')
  })
})
