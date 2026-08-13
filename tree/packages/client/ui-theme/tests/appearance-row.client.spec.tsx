// @vitest-environment jsdom
/** AppearanceRow behavior: three cubes, selection follows the persisted
 * preference, clicks drive setTheme; plus the skin picker and version bar. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import { SKIN_VERSION } from '../src/skin-version.ts'
import { updateInstruction } from '../src/client/update-check.ts'
import type { UpdateReport } from '../src/update-contract.ts'
import type { SkinId, ThemePreference } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  ...en,
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

/** How the fake Host answers the version route this test. */
let answer: UpdateReport | 'reject' = {
  current: SKIN_VERSION, harness: '0.1.0-rc.5', latest: null, state: 'unavailable',
}

/** How the fake clipboard answers. */
let clipboardOk = true

/** What the fake clipboard was handed, in order, so a test can read it back
 * without pulling `writeText` off the navigator it belongs to. */
let clipboardWrites: string[] = []

beforeEach(() => {
  answer = { current: SKIN_VERSION, harness: '0.1.0-rc.5', latest: null, state: 'unavailable' }
  clipboardOk = true
  clipboardWrites = []
  vi.stubGlobal('fetch', vi.fn(() => answer === 'reject'
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(answer) } as Response)))
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn((text: string) => {
        clipboardWrites.push(text)
        return clipboardOk ? Promise.resolve() : Promise.reject(new Error('denied'))
      }),
    },
  })
})

afterEach(() => { vi.unstubAllGlobals() })

function mount(
  preference: ThemePreference = 'system',
  skin: SkinId = 'qq-2008',
  hasCustom = false,
) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, 0)
  store.actions.syncSkin(skin, hasCustom)
  const setTheme = vi.fn()
  const setSkin = vi.fn()
  const setCustomImage = vi.fn(async () => {})
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
    setSkin,
    setCustomImage,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setSkin, setCustomImage }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

/** The version bar's line, once the initial read has landed. */
async function versionLine(): Promise<string> {
  const bar = await screen.findByText(new RegExp(`Skin system v${SKIN_VERSION}`))
  return bar.textContent ?? ''
}

describe('AppearanceRow', () => {
  it('renders the title and three cubes with the preference cube selected', () => {
    mount('dark')
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(pressed(/^Dark$/)).toBe('true')
    expect(pressed(/^Light$/)).toBe('false')
    expect(pressed(/^System$/)).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /^Light$/ }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed(/^Dark$/)).toBe('true')
    act(() => { b.store.actions.sync('light', 1) })
    expect(pressed(/^Light$/)).toBe('true')
    expect(pressed(/^Dark$/)).toBe('false')
  })
})

describe('the skin picker', () => {
  it('puts the custom entry first and offers to pick an image when there is none', () => {
    const b = mount('system', 'qq-2008', false)
    const skins = screen.getAllByRole('button', { name: /Custom|Default|QQ|Windows/ })
    expect(skins[0]?.textContent).toContain('Custom (pick)')
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')
    const click = vi.spyOn(picker as HTMLInputElement, 'click')
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    expect(click).toHaveBeenCalled()
    expect(b.setSkin).not.toHaveBeenCalled()
  })

  it('selects the existing custom skin rather than reopening the picker', () => {
    const b = mount('system', 'qq-2008', true)
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    expect(b.setSkin).toHaveBeenCalledWith('custom')
  })

  it('reopens the picker when the custom skin is already selected', () => {
    const b = mount('system', 'custom', true)
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')
    const click = vi.spyOn(picker as HTMLInputElement, 'click')
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    expect(click).toHaveBeenCalled()
    expect(b.setSkin).not.toHaveBeenCalled()
    expect(pressed(/Custom/)).toBe('true')
  })

  it('switches to a built-in skin on click', () => {
    const b = mount('system', 'qq-2008')
    fireEvent.click(screen.getByRole('button', { name: /Default/ }))
    expect(b.setSkin).toHaveBeenCalledWith('none')
  })

  it('reports progress while an image is being read, then settles', async () => {
    let release = (): void => {}
    const b = mount()
    b.setCustomImage.mockImplementation(async () => new Promise<void>((resolve) => { release = resolve }))
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')
    const file = new File(['x'], 'p.png', { type: 'image/png' })
    fireEvent.change(picker as HTMLInputElement, { target: { files: [file] } })
    expect(b.setCustomImage).toHaveBeenCalledWith(file)
    expect(await screen.findByText(/Reading colours/)).toBeDefined()
    await act(async () => { release() })
    expect(await screen.findByText(/Custom \(pick\)/)).toBeDefined()
  })

  it('asks for another image when the picked one cannot be used', async () => {
    const b = mount()
    b.setCustomImage.mockRejectedValue(new Error('undecodable'))
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')
    await act(async () => {
      fireEvent.change(picker as HTMLInputElement, {
        target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] },
      })
    })
    expect(await screen.findByText(/Try another image/)).toBeDefined()
    // The input is cleared, so the same file can be picked again.
    expect((picker as HTMLInputElement).value).toBe('')
  })

  it('does nothing when the dialog is dismissed without a file', () => {
    const b = mount()
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')
    fireEvent.change(picker as HTMLInputElement, { target: { files: [] } })
    expect(b.setCustomImage).not.toHaveBeenCalled()
  })
})

describe('the version bar', () => {
  it('shows the running versions without asking the Host to go online', async () => {
    mount()
    expect(await versionLine()).toContain('DSH 0.1.0-rc.5')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/ui-theme/update-check')
  })

  it('reports being up to date and stops offering the check', async () => {
    mount()
    await versionLine()
    answer = { current: SKIN_VERSION, harness: '0.1.0-rc.5', latest: SKIN_VERSION, state: 'current' }
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }))
    expect(await screen.findByText(/Up to date/)).toBeDefined()
    expect(screen.getByRole('button', { name: /Check for updates/ }).hasAttribute('disabled')).toBe(true)
  })

  it('names the newer version and offers the instruction instead', async () => {
    mount()
    await versionLine()
    answer = { current: SKIN_VERSION, harness: '0.1.0-rc.5', latest: '9.9.9', state: 'outdated' }
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }))
    expect(await screen.findByText(/Update available v9\.9\.9/)).toBeDefined()
    const copy = screen.getByRole('button', { name: /Copy update instruction/ })
    fireEvent.click(copy)
    await waitFor(() => { expect(screen.getByText(/paste it to your agent/)).toBeDefined() })
    const written = clipboardWrites[0] ?? ''
    expect(written).toContain('HeiGeAi/deepseek-harness-skin')
    expect(written).toContain(`v${SKIN_VERSION}`)
    expect(written).toContain('v9.9.9')
  })

  it('lets a refused copy be retried', async () => {
    clipboardOk = false
    mount()
    await versionLine()
    answer = { current: SKIN_VERSION, harness: '0.1.0-rc.5', latest: '9.9.9', state: 'outdated' }
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Copy update instruction/ }))
    expect(await screen.findByText(/Copy failed/)).toBeDefined()
    // Still the copy button, so the retry does not re-run the check.
    expect(screen.getByRole('button', { name: /Copy update instruction/ })).toBeDefined()
  })

  it('says so plainly when the check cannot run', async () => {
    mount()
    await versionLine()
    answer = 'reject'
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }))
    expect(await screen.findByText(/Could not check right now/)).toBeDefined()
    // And the check stays available, because the next attempt may work.
    expect(screen.getByRole('button', { name: /Check for updates/ }).hasAttribute('disabled')).toBe(false)
  })

  it('degrades rather than throwing when the Host answers with an error', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    mount()
    expect(await screen.findByText(/^Skin system$/)).toBeDefined()
  })

  it('names both versions and the repository in the instruction it copies', async () => {
    // A total function over the report shape: the bar only ever hands it an
    // outdated one, but a report with no named upgrade still has to read.
    expect(updateInstruction({ current: '1.0.0', harness: '0.1.0-rc.5', latest: null, state: 'unavailable' }))
      .toContain('最新发布版本：vunknown')
    const text = updateInstruction({ current: '1.0.0', harness: '0.1.0-rc.5', latest: '2.0.0', state: 'outdated' })
    expect(text).toContain('最新发布版本：v2.0.0')
    expect(text).toContain('当前皮肤系统版本：v1.0.0')
    expect(text).toContain('当前 DSH 版本：0.1.0-rc.5')
  })

  it('writes no state when it is unmounted mid-flight', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let land: (value: Response) => void = () => {}
    vi.mocked(fetch).mockImplementation(async () => new Promise<Response>((resolve) => { land = resolve }))
    mount()
    cleanup()
    await act(async () => {
      land({ ok: true, json: () => Promise.resolve(answer) } as Response)
    })
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
