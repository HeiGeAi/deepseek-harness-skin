// @vitest-environment jsdom
/**
 * The skin half of the client plugin, driven through a real settings scope.
 *
 * The settings subscription is the only writer of the skin DOM, so every case
 * here goes the long way round: the row's face writes a field, the Host answers,
 * and the assertion reads what landed on `document.body`.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceRowInjected } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  EMPTY_CUSTOM_SKIN, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema, type ThemeSettings,
} from '../src/theme-settings.ts'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import { CUSTOM_SKIN_STYLE_ID } from '../src/skins/custom.ts'
import type { createAppearanceRowStore } from '../src/client/settings-store.ts'

usePinnedBrowserLanguages('zh-CN')

const SLOT = 'settings.general.item'
const SKIN_ATTRIBUTE = 'data-dsh-skin'
const CHROME_ATTRIBUTE = 'data-skin-chrome'

/** A canvas that answers with a fixed sample, since jsdom has none. */
class FakeCanvas {
  constructor(readonly width: number, readonly height: number) {}

  getContext(): unknown {
    return {
      drawImage: () => undefined,
      // A bright, warm picture: enough for the extractor to call it light.
      getImageData: () => ({ data: new Uint8ClampedArray(4_000).fill(230) }),
    }
  }

  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob(['webp'], { type: 'image/webp' }))
  }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(
    { width: 800, height: 400, close: () => undefined } as unknown as ImageBitmap,
  )))
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ image: 'skin-picked.webp' }),
  } as Response)))
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.removeAttribute(SKIN_ATTRIBUTE)
  document.body.removeAttribute(CHROME_ATTRIBUTE)
  document.getElementById(CUSTOM_SKIN_STYLE_ID)?.remove()
})

/**
 * A context carrying a live settings scope over an in-memory theme section.
 * @param seed - the section the Host starts out holding.
 * @returns the context, its slot registry, and the section itself.
 */
async function bench(seed: Partial<ThemeSettings> = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const section: ThemeSettings = {
    preference: 'system', skin: 'none', customSkin: EMPTY_CUSTOM_SKIN, ...seed,
  }
  let revision = 0
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE,
    schema: ThemeSettingsSchema.toJSON(),
    // A fresh object per read, as the real decode produces: the plugin's
    // change check has to be by value or every write would look like a change.
    value: { ...section, customSkin: { ...section.customSkin } },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const mutate = vi.fn((request: { ops: { path: string[]; value: unknown }[] }) => {
    const op = request.ops[0]!
    Object.assign(section, { [op.path[0]!]: op.value })
    revision += 1
    return Promise.resolve({ rpcId: 'skin-mutate' as never, result: { ok: true as const, value: namespace() } })
  })
  ctx.provide('connection', {
    api: {
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'skin-describe' as never,
          result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [namespace()] } },
        })),
        mutate,
      },
    },
    isLoopback: true,
  } as never)
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never, () => null)
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, slots, section, mutate }
}

/** Bake the row's store and take the face the plugin injects into it. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === AppearanceRow)!
  const instance = (entry.store as ReturnType<typeof createAppearanceRowStore>).create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => AppearanceRowInjected)(instance.actions)
  return { instance, face }
}

/** Both skin attributes, as the document currently carries them. */
const stamped = (): (string | null)[] =>
  [document.body.getAttribute(SKIN_ATTRIBUTE), document.body.getAttribute(CHROME_ATTRIBUTE)]

describe('the skin the settings document names', () => {
  it('is stamped onto the body at activation and cleared when it goes back to stock', async () => {
    const b = await bench({ skin: 'qq-2008' })
    expect(stamped()).toEqual(['qq-2008', 'glass'])
    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot().skin).toBe('qq-2008')

    face.setSkin('none')
    // The picker never writes the DOM itself; the round trip does.
    await vi.waitFor(() => { expect(stamped()).toEqual([null, null]) })
    expect(instance.getSnapshot().skin).toBe('none')
  })

  it('ignores a settings write that leaves the skin exactly where it was', async () => {
    const b = await bench({ skin: 'qq-2008' })
    const { face } = faceOf(b.slots)
    face.setTheme('dark')
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalled() })
    // Same skin, freshly decoded object: still the same skin.
    expect(stamped()).toEqual(['qq-2008', 'glass'])
  })
})

describe('picking an image', () => {
  it('derives a skin from it, persists both fields, and paints the result', async () => {
    const b = await bench()
    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot().hasCustom).toBe(false)

    await face.setCustomImage(new File(['bytes'], 'picked.png', { type: 'image/png' }))

    const stored = b.section.customSkin
    expect(stored.image).toBe('skin-picked.webp')
    expect(stored.veil).toBeGreaterThan(0)
    expect(b.section.skin).toBe('custom')
    await vi.waitFor(() => { expect(stamped()).toEqual(['custom', stored.chrome]) })
    // Its rules are derived rather than bundled, so they have to be published
    // into the document before the attribute selecting them means anything.
    expect(document.getElementById(CUSTOM_SKIN_STYLE_ID)?.textContent).toContain('skin-picked.webp')
    expect(instance.getSnapshot().hasCustom).toBe(true)
  })

  it('leaves the document alone when the picture cannot be stored', async () => {
    const b = await bench({ skin: 'qq-2008' })
    const { face } = faceOf(b.slots)
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response)
    await expect(face.setCustomImage(new File(['x'], 'p.png'))).rejects.toThrow('skin upload failed: 500')
    expect(b.section.skin).toBe('qq-2008')
    expect(stamped()).toEqual(['qq-2008', 'glass'])
  })
})
