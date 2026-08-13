/**
 * Browser half of the custom skin: a photograph in, a skin out.
 *
 * The pipeline is deliberately short and all of it is local. The picture is
 * decoded once, sampled small for colour, re-encoded larger for display, and
 * only the compressed bytes leave the tab. Nothing is uploaded anywhere but
 * the user's own harness home, and the palette is computed here rather than on
 * the Host so the picker can show the result before anything is persisted.
 *
 * The colour work itself lives in `skins/extract.ts` and `skins/derive.ts`,
 * which know nothing about canvases; this file is the part that needs a DOM.
 */

import { extractPalette, tuneCustomSkin, type TunedSkin } from '../skins/extract.ts'
import { customSkinCss, CUSTOM_SKIN_STYLE_ID, SKIN_UPLOAD_ROUTE } from '../skins/custom.ts'
import { STOCK } from '../styles/skins/generated/stock.ts'
import type { CustomSkin } from '../theme-settings.ts'

/**
 * Width the image is sampled at for colour. Small on purpose: the histogram
 * wants area, not detail, and downscaling averages neighbouring pixels, which
 * is exactly the pooling the buckets would do anyway.
 */
const SAMPLE_WIDTH = 96

/** Longest edge kept for display. A background never needs more than this. */
const STORE_EDGE = 1920

/** webp quality for the stored copy; visually clean at a fraction of the bytes. */
const STORE_QUALITY = 0.82

/** What one picked image produced, before it is persisted. */
export interface BuiltSkin {
  /** The skin to persist. */
  custom: CustomSkin
  /** Contract results, including how far the veil had to be raised. */
  report: TunedSkin
}

/**
 * Draw a bitmap into a canvas at a bounded size.
 * @param bitmap - the decoded image.
 * @param maxEdge - longest edge of the result.
 * @returns a canvas holding the scaled image, plus its 2D context.
 */
function scaleToCanvas(
  bitmap: ImageBitmap, maxEdge: number,
): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas unavailable')
  context.drawImage(bitmap, 0, 0, width, height)
  return { canvas, context }
}

/**
 * Send the compressed image to the Host and learn the name it is served under.
 * @param blob - the webp bytes.
 * @returns the stored filename.
 */
async function upload(blob: Blob): Promise<string> {
  const response = await fetch(SKIN_UPLOAD_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'image/webp' },
    body: blob,
  })
  if (!response.ok) throw new Error(`skin upload failed: ${response.status}`)
  const body = await response.json() as { image?: unknown }
  if (typeof body.image !== 'string' || body.image === '') throw new Error('skin upload returned no filename')
  return body.image
}

/**
 * Turn a picked image file into a persisted custom skin.
 *
 * The picture is decoded once and used twice: sampled at {@link SAMPLE_WIDTH}
 * to read its colours, and re-encoded at {@link STORE_EDGE} to be the hero.
 * Sampling the small copy and storing the large one is what keeps a 12-megapixel
 * photo from costing twelve megapixels of histogram work.
 *
 * @param file - the image the user picked.
 * @returns the skin to persist and the contract report behind it.
 * @throws when the file cannot be decoded, encoded, or stored.
 */
export async function buildCustomSkin(file: File): Promise<BuiltSkin> {
  const bitmap = await createImageBitmap(file)
  try {
    const sample = scaleToCanvas(bitmap, SAMPLE_WIDTH)
    const pixels = sample.context.getImageData(0, 0, sample.canvas.width, sample.canvas.height).data
    const extracted = extractPalette(pixels)
    const report = tuneCustomSkin(extracted, STOCK)

    const stored = scaleToCanvas(bitmap, STORE_EDGE)
    const blob = await stored.canvas.convertToBlob({ type: 'image/webp', quality: STORE_QUALITY })
    const image = await upload(blob)

    return {
      report,
      custom: {
        image,
        appearance: report.theme.appearance,
        chrome: report.theme.chrome,
        veil: report.theme.veil,
        focus: '50% 50%',
        seeds: report.theme.seeds,
      },
    }
  } finally {
    bitmap.close()
  }
}

/**
 * Publish the custom skin's rules into the document.
 *
 * The Host already inlined an identical element for whatever was persisted at
 * boot, so this adopts that element rather than adding a second one — two
 * stylesheets scoped to the same selector would leave the winner decided by
 * document order instead of by which skin the user last picked.
 * @param custom - the current custom skin, or undefined to clear the rules.
 */
export function applyCustomSkinStyle(custom: CustomSkin | undefined): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(CUSTOM_SKIN_STYLE_ID)
  if (custom === undefined || custom.image === '') {
    existing?.remove()
    return
  }
  const css = customSkinCss(custom)
  if (existing !== null) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.id = CUSTOM_SKIN_STYLE_ID
  style.textContent = css
  document.head.append(style)
}
