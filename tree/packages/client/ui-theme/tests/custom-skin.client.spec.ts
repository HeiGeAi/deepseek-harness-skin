// @vitest-environment jsdom
/**
 * The browser half of the custom skin: decode a picked picture once, sample it
 * small for colour, re-encode it large for display, and publish the rules.
 *
 * Canvases do not exist in jsdom, so the two browser APIs this file needs are
 * stood up here rather than mocked away — the fake canvas records the sizes it
 * was asked for, which is the part worth asserting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCustomSkinStyle, buildCustomSkin } from '../src/client/custom-skin.ts'
import { customSkinCss, CUSTOM_SKIN_STYLE_ID, SKIN_UPLOAD_ROUTE } from '../src/skins/custom.ts'
import { parseColor } from '../src/skins/color.ts'
import { EMPTY_CUSTOM_SKIN, type CustomSkin } from '../src/theme-settings.ts'

/** A solid opaque RGBA buffer, enough of a picture for the extractor. */
function pixels(): Uint8ClampedArray {
  const blocks = [
    { hex: '#f6f0e4', count: 700 },
    { hex: '#c8873a', count: 200 },
    { hex: '#3a6ec8', count: 100 },
  ]
  const out = new Uint8ClampedArray(1000 * 4)
  let at = 0
  for (const block of blocks) {
    const [r, g, b] = parseColor(block.hex)
    for (let i = 0; i < block.count; i += 1) {
      out.set([r ?? 0, g ?? 0, b ?? 0, 255], at)
      at += 4
    }
  }
  return out
}

/** Every canvas the run under test constructed, in construction order. */
let canvases: FakeCanvas[] = []

/** What `getContext` should hand back next; null stands for a lost context. */
let contextAvailable = true

/** A canvas that records its size and hands over a fixed sample. */
class FakeCanvas {
  readonly drawn: unknown[] = []
  readonly blobs: { type?: string; quality?: number }[] = []
  constructor(readonly width: number, readonly height: number) { canvases.push(this) }

  getContext(kind: string): unknown {
    if (!contextAvailable) return null
    return {
      kind,
      drawImage: (...args: unknown[]) => { this.drawn.push(args) },
      getImageData: () => ({ data: pixels() }),
    }
  }

  convertToBlob(options: { type?: string; quality?: number } = {}): Promise<Blob> {
    this.blobs.push(options)
    return Promise.resolve(new Blob(['webp-bytes'], { type: options.type ?? '' }))
  }
}

/** A decoded picture of the given size, which records its own closure. */
function bitmap(width: number, height: number): ImageBitmap & { closed: boolean } {
  const it = { width, height, closed: false, close: () => { it.closed = true } }
  return it
}

/** How the Host answers the upload route this test. */
let upload: { ok: boolean; status?: number; body: unknown } = { ok: true, body: { image: 'skin-abc.webp' } }

const file = (): File => new File(['bytes'], 'picked.png', { type: 'image/png' })

beforeEach(() => {
  canvases = []
  contextAvailable = true
  upload = { ok: true, body: { image: 'skin-abc.webp' } }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(4000, 2000))))
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: upload.ok,
    status: upload.status ?? 200,
    json: () => Promise.resolve(upload.body),
  } as Response)))
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.getElementById(CUSTOM_SKIN_STYLE_ID)?.remove()
})

describe('buildCustomSkin', () => {
  it('samples small, stores large, and persists what the tuner settled on', async () => {
    const built = await buildCustomSkin(file())
    // Sampled at 96 across and stored at 1920, both from the same 2:1 picture.
    expect(canvases.map(canvas => [canvas.width, canvas.height])).toEqual([[96, 48], [1920, 960]])
    expect(canvases[1]?.blobs).toEqual([{ type: 'image/webp', quality: 0.82 }])
    expect(built.custom.image).toBe('skin-abc.webp')
    expect(built.custom.focus).toBe('50% 50%')
    expect(built.custom.appearance).toBe(built.report.theme.appearance)
    expect(built.custom.chrome).toBe(built.report.theme.chrome)
    expect(built.custom.veil).toBe(built.report.theme.veil)
    expect(built.custom.seeds).toEqual(built.report.theme.seeds)
    expect(built.report.pass).toBe(true)
  })

  it('sends the compressed bytes to the Host, and nothing else leaves the tab', async () => {
    await buildCustomSkin(file())
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []
    expect(url).toBe(SKIN_UPLOAD_ROUTE)
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'image/webp' } })
    expect(init?.body).toBeInstanceOf(Blob)
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
  })

  it('closes the decoded picture whether the pipeline finishes or throws', async () => {
    const decoded = bitmap(4000, 2000)
    vi.mocked(createImageBitmap).mockResolvedValue(decoded)
    await buildCustomSkin(file())
    expect(decoded.closed).toBe(true)

    const doomed = bitmap(4000, 2000)
    vi.mocked(createImageBitmap).mockResolvedValue(doomed)
    upload = { ok: false, status: 503, body: {} }
    await expect(buildCustomSkin(file())).rejects.toThrow('skin upload failed: 503')
    expect(doomed.closed).toBe(true)
  })

  it('never upscales a picture smaller than the bound', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(bitmap(120, 300))
    await buildCustomSkin(file())
    // The long edge is the height here, and the store pass leaves it alone.
    expect(canvases.map(canvas => [canvas.width, canvas.height])).toEqual([[38, 96], [120, 300]])
  })

  it('keeps a degenerate picture at one pixel rather than at none', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(bitmap(0, 0))
    await buildCustomSkin(file())
    expect(canvases.map(canvas => [canvas.width, canvas.height])).toEqual([[1, 1], [1, 1]])
  })

  it('says so plainly when the browser cannot give it a 2D context', async () => {
    contextAvailable = false
    await expect(buildCustomSkin(file())).rejects.toThrow('2D canvas unavailable')
  })

  it('refuses an upload answer that names no file', async () => {
    for (const body of [{}, { image: '' }, { image: 42 }]) {
      upload = { ok: true, body }
      await expect(buildCustomSkin(file())).rejects.toThrow('skin upload returned no filename')
    }
  })
})

describe('applyCustomSkinStyle', () => {
  const made: CustomSkin = { ...EMPTY_CUSTOM_SKIN, image: 'skin-abc.webp' }

  /** The rules currently published into the document, if any. */
  const published = (): string | null =>
    document.getElementById(CUSTOM_SKIN_STYLE_ID)?.textContent ?? null

  it('publishes the rules when nothing has been inlined yet', () => {
    applyCustomSkinStyle(made)
    expect(published()).toBe(customSkinCss(made))
  })

  it('adopts the element the Host inlined rather than adding a second one', () => {
    const inlined = document.createElement('style')
    inlined.id = CUSTOM_SKIN_STYLE_ID
    inlined.textContent = 'stale'
    document.head.append(inlined)
    applyCustomSkinStyle(made)
    // Two stylesheets on the same selector would let document order decide the
    // winner, so there must still be exactly one.
    expect(document.querySelectorAll(`#${CUSTOM_SKIN_STYLE_ID}`)).toHaveLength(1)
    expect(inlined.textContent).toBe(customSkinCss(made))
  })

  it('leaves an already-current element untouched', () => {
    applyCustomSkinStyle(made)
    const element = document.getElementById(CUSTOM_SKIN_STYLE_ID)
    const write = vi.fn()
    Object.defineProperty(element, 'textContent', { get: () => customSkinCss(made), set: write })
    applyCustomSkinStyle(made)
    expect(write).not.toHaveBeenCalled()
  })

  it('clears the rules when the skin goes away or has no picture behind it', () => {
    applyCustomSkinStyle(made)
    applyCustomSkinStyle(EMPTY_CUSTOM_SKIN)
    expect(published()).toBeNull()
    applyCustomSkinStyle(made)
    applyCustomSkinStyle(undefined)
    expect(published()).toBeNull()
    // Clearing what was never published is quiet.
    applyCustomSkinStyle(undefined)
    expect(published()).toBeNull()
  })

  it('does nothing at all off a document, which is where the Host runs it', () => {
    vi.stubGlobal('document', undefined)
    expect(() => { applyCustomSkinStyle(made) }).not.toThrow()
  })
})
