import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_PREFERENCE, DEFAULT_SKIN, EMPTY_CUSTOM_SKIN, THEME_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-ui-theme'
import { SKIN_IMAGE_ROUTE, SKIN_UPLOAD_ROUTE } from '../src/skins/custom.ts'
import { UPDATE_CHECK_ROUTE } from '../src/update-contract.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** One registered route, as the plugin asked for it. */
interface Route {
  /** Exact match or prefix match. */
  kind: string
  /** The path it was registered under. */
  path: string
  /** Whether the plugin's effect has been unwound. */
  live: boolean
}

/**
 * A web server that records the index transform and every registered route.
 * @returns the fake plus what it recorded.
 */
function webServerStub(): {
  server: WebServer
  routes: Route[]
  index: () => string | undefined
  indexLive: () => boolean
} {
  const routes: Route[] = []
  let transform: ((html: string) => string) | undefined
  let live = false
  const server = {
    tapIndex: (next: (html: string) => string) => {
      transform = next
      live = true
      // The transform itself is retained past its disposer so a test can still
      // ask what a torn-down plugin would render.
      return () => { live = false }
    },
    register: ({ kind, path }: { kind: string; path: string }) => {
      const route: Route = { kind, path, live: true }
      routes.push(route)
      return () => { route.live = false }
    },
  } as unknown as WebServer
  return { server, routes, index: () => transform?.('<body></body>'), indexLive: () => live }
}

describe('ui-theme host', () => {
  it('registers, validates, and disposes the durable theme namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(THEME_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns))
      .toEqual({ preference: DEFAULT_PREFERENCE, skin: DEFAULT_SKIN, customSkin: EMPTY_CUSTOM_SKIN })
    await ctx.settings.update(ns, { preference: 'dark' })
    expect(ctx.settings.get(ns))
      .toEqual({ preference: 'dark', skin: DEFAULT_SKIN, customSkin: EMPTY_CUSTOM_SKIN })
    await expect(ctx.settings.update(ns, { preference: 'sepia' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('renders the current durable preference and disposes the index transform', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const web = webServerStub()
    ctx.provide('webServer', web.server)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    // The default skin pins light, so the durable preference reaches the
    // bootstrap through the skin attributes rather than through the scheme.
    expect(web.index()).toContain("setAttribute('data-dsh-skin', \"qq-2008\")")
    expect(web.index()).toContain('const dark = false')
    await ctx.settings.update(settingsNamespace(THEME_SETTINGS_NAMESPACE), { preference: 'dark', skin: 'none' })
    expect(web.index()).toContain("removeAttribute('data-dsh-skin')")
    expect(web.index()).toContain('const dark = "dark" === \'dark\'')
    await fiber.dispose()
    expect(web.indexLive()).toBe(false)
    // Its namespace went with it, so the same transform now reads nothing from
    // the settings provider and falls back to the schema defaults.
    expect(web.index()).toContain("setAttribute('data-dsh-skin', \"qq-2008\")")
    expect(web.index()).toContain('const dark = false')
  })

  it('serves the custom skin store and the update check, and unwinds both with the fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const web = webServerStub()
    ctx.provide('webServer', web.server)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    // Two routes for the photograph — one to put it in the harness home, one to
    // read it back — plus the version route the appearance row polls.
    expect(web.routes.map(route => [route.kind, route.path])).toEqual([
      ['exact', SKIN_UPLOAD_ROUTE],
      ['prefix', SKIN_IMAGE_ROUTE],
      ['exact', UPDATE_CHECK_ROUTE],
    ])
    expect(web.routes.every(route => route.live)).toBe(true)
    await fiber.dispose()
    expect(web.routes.some(route => route.live)).toBe(false)
  })

  it('falls back to the schema defaults when only an HTTP server exists', async () => {
    const ctx = new Context()
    const web = webServerStub()
    ctx.provide('webServer', web.server)
    await ctx.plugin({ apply }).await()
    const html = web.index() ?? ''
    // The default preference is `system`, but the default skin pins light, so
    // the emitted bootstrap never has to consult the OS.
    expect(html).toContain(`setAttribute('data-dsh-skin', "${DEFAULT_SKIN}")`)
    expect(html).toContain('const dark = false')
    expect(html).not.toContain('matchMedia')
  })
})
