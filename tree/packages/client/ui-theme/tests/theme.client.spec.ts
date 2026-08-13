// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SkinId,
  ThemePreference,
  ThemeSettings,
  ThemeSnapshot,
  ThemeTokenOverrides,
} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  CUSTOM_SKIN, DEFAULT_SKIN, EMPTY_CUSTOM_SKIN, skinAppearance, skinChrome,
} from '../src/theme-settings.ts'

/**
 * A scope standing at the stock look, so cases that exercise preference
 * resolution are not also exercising skin pinning: a skin declares the scheme
 * its palette was generated for and pins it, and `none` is the only value that
 * defers to the preference.
 */
const stockScope = (): StubSettingsScope<ThemeSettings> => {
  const host = stubSettingsScope<ThemeSettings>()
  host.publish({ status: 'ready', value: { preference: 'system', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN }, revision: 1, writable: true })
  return host
}

const make = (host = stockScope()): {
  ctx: Context
  theme: ThemeRuntime
  events: ThemeSnapshot[]
  host: StubSettingsScope<ThemeSettings>
} => {
  const ctx = new Context()
  const events: ThemeSnapshot[] = []
  // Subscribed after construction: adopting the standing section is setup, not
  // a change under test, and every count below is of post-construction events.
  const theme = new ThemeRuntime(ctx, host.scope)
  ctx.on('theme/change', (snapshot) => { events.push(snapshot) })
  return { ctx, theme, events, host }
}

describe('ThemeRuntime', () => {
  it('defaults to the system preference resolved against prefers-color-scheme', () => {
    const { theme } = make()
    const snapshot = theme.getTheme()
    expect(snapshot.preference).toBe('system')
    // jsdom matchMedia is absent; system resolves to light.
    expect(snapshot.active.id).toBe('light')
    expect(snapshot.active.colorScheme).toBe('light')
    expect(snapshot.themes.map(t => t.id)).toEqual(['light', 'dark'])
  })

  it('setTheme switches, writes through the scope, republishes, and keeps DOM untouched', () => {
    const { theme, events, host } = make()
    theme.setTheme('dark')
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().active.colorScheme).toBe('dark')
    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(theme.getTheme())
    // The service never touches presentation state.
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    // Same-value set is a no-op (no extra event).
    theme.setTheme('dark')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a published Host section without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'dark', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN }, revision: 1, writable: true })
    expect(theme.getTheme().preference).toBe('dark')
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { preference: 'dark', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN }, revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ThemeSettings>()
    host.publish({ status: 'ready', value: { preference: 'dark', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN }, revision: 1, writable: true })
    const { theme } = make(host)
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('throws on unknown setTheme ids, duplicate registration, and the system id', () => {
    const { theme } = make()
    expect(() => { theme.setTheme('sepia') }).toThrow('not registered')
    expect(() => theme.register({ id: 'light', colorScheme: 'light', tokens: {} })).toThrow('already registered')
    expect(() => theme.register({ id: 'system', colorScheme: 'light', tokens: {} })).toThrow('preference')
  })

  it('registered themes join the snapshot; disposing the active one resets to default', () => {
    const { theme, events, host } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: { '--dsw-alias-bg-base': 'red' } })
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark', 'sepia'])
    theme.setTheme('sepia')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('red')
    dispose()
    expect(theme.getTheme().preference).toBe('system')
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark'])
    // Custom ids are in-process extension themes; only the built-in product
    // preferences cross the Host settings schema.
    expect(host.set).not.toHaveBeenCalled()
    // register + set + dispose = three publishes; disposer is idempotent.
    expect(events.length).toBe(3)
    dispose()
    expect(events.length).toBe(3)
  })

  it('disposing an inactive theme keeps the active preference', () => {
    const { theme } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: {} })
    theme.setTheme('dark')
    dispose()
    expect(theme.getTheme().preference).toBe('dark')
  })

  describe('a skin pins the scheme its palette was generated for', () => {
    const withSkin = (preference: ThemePreference, skin: SkinId): ThemeRuntime => {
      const host = stubSettingsScope<ThemeSettings>()
      host.publish({ status: 'ready', value: { preference, skin, customSkin: EMPTY_CUSTOM_SKIN }, revision: 1, writable: true })
      return make(host).theme
    }

    it('resolves dark for a dark skin even under a light preference', () => {
      const snapshot = withSkin('light', 'waves-1').getTheme()
      expect(snapshot.preference).toBe('light')
      expect(snapshot.active.colorScheme).toBe('dark')
    })

    it('resolves light for a light skin even under a dark preference', () => {
      const snapshot = withSkin('dark', 'qq-2008').getTheme()
      expect(snapshot.preference).toBe('dark')
      expect(snapshot.active.colorScheme).toBe('light')
    })

    it('follows the preference again once the skin is cleared', () => {
      const host = stubSettingsScope<ThemeSettings>()
      host.publish({ status: 'ready', value: { preference: 'dark', skin: 'waves-1', customSkin: EMPTY_CUSTOM_SKIN }, revision: 1, writable: true })
      const { theme } = make(host)
      host.publish({ value: { preference: 'dark', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN }, revision: 2 })
      expect(theme.getTheme().active.colorScheme).toBe('dark')
      host.publish({ value: { preference: 'light', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN }, revision: 3 })
      expect(theme.getTheme().active.colorScheme).toBe('light')
    })

    it('falls back to the default skin for an id this build no longer generates', () => {
      // A settings document outlives the theme file it names. The schema would
      // already have substituted the default for such a value, so the runtime
      // agrees with it rather than throwing or inventing a third answer.
      const host = stubSettingsScope<ThemeSettings>()
      host.publish({
        status: 'ready',
        value: { preference: 'dark', skin: 'retired-skin' as SkinId, customSkin: EMPTY_CUSTOM_SKIN },
        revision: 1,
        writable: true,
      })
      expect(skinAppearance(DEFAULT_SKIN)).toBe('light')
      expect(make(host).theme.getTheme().active.colorScheme).toBe('light')
    })

    it('reads the custom skin from the document instead of the manifest', () => {
      // The custom skin has no manifest entry to look up: its scheme and chrome
      // were decided by the picture the user picked, and they travel with it.
      const made = { ...EMPTY_CUSTOM_SKIN, image: 'skin-1.webp', appearance: 'dark' as const, chrome: 'neon' as const }
      expect(skinAppearance(CUSTOM_SKIN, made)).toBe('dark')
      expect(skinChrome(CUSTOM_SKIN, made)).toBe('neon')

      const host = stubSettingsScope<ThemeSettings>()
      host.publish({
        status: 'ready',
        value: { preference: 'light', skin: CUSTOM_SKIN, customSkin: made },
        revision: 1,
        writable: true,
      })
      expect(make(host).theme.getTheme().active.colorScheme).toBe('dark')
    })

    it('degrades the custom skin to the stock look until an image exists', () => {
      // Selecting `custom` before making one is a normal state, so it resolves
      // to "nothing pinned" and the preference wins, image or no image.
      expect(skinAppearance(CUSTOM_SKIN, EMPTY_CUSTOM_SKIN)).toBeNull()
      expect(skinChrome(CUSTOM_SKIN, EMPTY_CUSTOM_SKIN)).toBeNull()
      expect(skinAppearance(CUSTOM_SKIN)).toBeNull()
      expect(skinChrome(CUSTOM_SKIN)).toBeNull()
      expect(withSkin('dark', CUSTOM_SKIN).getTheme().active.colorScheme).toBe('dark')
      // The same "nothing pinned" answer covers the stock look and an id the
      // manifest no longer carries.
      expect(skinChrome('none')).toBeNull()
      expect(skinChrome('retired-skin' as SkinId)).toBeNull()
    })
  })

  it('revision increases monotonically across every publish', () => {
    const { theme, events } = make()
    theme.setTheme('dark')
    theme.setTheme('light')
    const dispose = theme.register({ id: 'sepia', colorScheme: 'dark', tokens: {} })
    dispose()
    // Starts at 2: adopting the standing section at construction spent 1.
    expect(events.map(e => e.revision)).toEqual([2, 3, 4, 5])
  })

  it('stacks reversible token overrides in call order and selects the active palette value', () => {
    const { theme } = make()
    const firstTokens: ThemeTokenOverrides = {
      '--shared': { light: 'first-light', dark: 'first-dark' },
      '--first': { light: 'first-only-light', dark: 'first-only-dark' },
    }
    const disposeFirst = theme.overrideTokens('first', firstTokens)
    firstTokens['--shared']!.light = 'mutated-after-call'
    const disposeSecond = theme.overrideTokens('second', {
      '--shared': { light: 'second-light', dark: 'second-dark' },
    })

    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-light',
      '--shared': 'second-light',
    })
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-dark',
      '--shared': 'second-dark',
    })

    disposeSecond()
    expect(theme.getTheme().active.tokens['--shared']).toBe('first-dark')
    disposeFirst()
    expect(theme.getTheme().active.tokens['--shared']).toBeUndefined()
  })

  it('replacing one source leaves its stale disposer harmless', () => {
    const { theme, events } = make()
    const stale = theme.overrideTokens('package', {
      '--old': { light: 'old-light', dark: 'old-dark' },
    })
    const current = theme.overrideTokens('package', {
      '--new': { light: 'new-light', dark: 'new-dark' },
    })
    stale()
    expect(theme.getTheme().active.tokens).toEqual({ '--new': 'new-light' })
    current()
    current()
    expect(theme.getTheme().active.tokens).toEqual({})
    expect(events).toHaveLength(3)
  })

  it('exports sorted built-in, registered, and override-only token descriptions as copies', () => {
    const { theme } = make()
    theme.register({
      id: 'custom',
      colorScheme: 'light',
      tokens: {
        '--dsw-alias-bg-base': 'duplicate-built-in',
        '--registered': 'registered',
      },
    })
    theme.overrideTokens('package', {
      '--registered': { light: 'duplicate-registered', dark: 'duplicate-registered' },
      semanticAccent: { light: 'pink', dark: 'red' },
    })

    const tokens = theme.exportInspectTokens()
    expect(tokens.map(token => token.name)).toEqual([...tokens.map(token => token.name)].sort())
    expect(tokens.find(token => token.name === '--registered')).toMatchObject({
      valueType: 'CSS value',
      cssVariable: '--registered',
    })
    const semantic = tokens.find(token => token.name === 'semanticAccent')
    expect(semantic).toMatchObject({ valueType: 'CSS value' })
    expect(semantic).not.toHaveProperty('cssVariable')
    expect(tokens.filter(token => token.name === '--dsw-alias-bg-base')).toHaveLength(1)

    tokens[0]!.description = 'caller mutation'
    expect(theme.exportInspectTokens()[0]!.description).not.toBe('caller mutation')
  })

  it('rejects every malformed token override value with a teaching error', () => {
    const { theme } = make()
    const override = (value: unknown): void => {
      theme.overrideTokens('package', { '--bad': value } as unknown as ThemeTokenOverrides)
    }
    expect(() => { override('red') }).toThrow(/bare string.*light.*dark/)
    for (const value of [1, null, {}, { light: 1, dark: 'dark' }, { light: 'light' }]) {
      expect(() => { override(value) }).toThrow(/must map to a \{ light, dark \} pair/)
    }
  })

  it('context dispose releases the scope subscription', async () => {
    const { ctx, host } = make()
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  describe('prefers-color-scheme resolution (stubbed matchMedia)', () => {
    type Listener = () => void
    const stubMedia = (initialMatches: boolean) => {
      const listeners = new Set<Listener>()
      const media = {
        matches: initialMatches,
        addEventListener: (_: 'change', fn: Listener) => { listeners.add(fn) },
        removeEventListener: (_: 'change', fn: Listener) => { listeners.delete(fn) },
        flip() {
          this.matches = !this.matches
          for (const fn of listeners) fn()
        },
        listenerCount: () => listeners.size,
      }
      vi.stubGlobal('matchMedia', () => media)
      return media
    }

    afterEach(() => { vi.unstubAllGlobals() })

    it('system resolves against the media query and follows OS flips', () => {
      const media = stubMedia(true)
      const { theme, events } = make()
      expect(theme.getTheme().preference).toBe('system')
      expect(theme.getTheme().active.id).toBe('dark')
      media.flip()
      expect(theme.getTheme().active.id).toBe('light')
      expect(events).toHaveLength(1)
    })

    it('OS flips do not republish while a concrete preference is set', () => {
      const media = stubMedia(false)
      const { theme, events } = make()
      theme.setTheme('light')
      expect(events).toHaveLength(1)
      media.flip()
      expect(events).toHaveLength(1)
      expect(theme.getTheme().active.id).toBe('light')
    })

    it('context dispose releases the media listener', async () => {
      const media = stubMedia(false)
      const { ctx } = make()
      expect(media.listenerCount()).toBe(1)
      await ctx.fiber.dispose()
      expect(media.listenerCount()).toBe(0)
    })
  })
})
