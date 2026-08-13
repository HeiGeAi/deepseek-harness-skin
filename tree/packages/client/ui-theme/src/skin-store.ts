/**
 * Host-side storage for custom skin images.
 *
 * A custom skin's photograph cannot live in the settings document — it is a
 * few hundred kilobytes of binary, and the document is read on every boot — so
 * the bytes go to `~/.dsh/skins/` and the document keeps only the filename.
 *
 * The filename is the content hash, never anything the browser chose. That is
 * what makes the read route safe by construction: a name that does not match
 * the hash pattern cannot name a file, so there is no traversal to defend
 * against, and a name that does match resolves inside the skins directory by
 * definition. Content addressing also means re-uploading the same picture
 * costs nothing and the cache header can be `immutable` honestly.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { SKIN_IMAGE_ROUTE } from './skins/custom.ts'

/** Directory under the harness home holding uploaded skin images. */
export const SKIN_STORE_DIR = 'skins'

/**
 * Largest image accepted. A skin background is compressed to webp in the
 * browser before it is sent, so anything past this is a client that skipped
 * that step rather than a legitimately large photograph.
 */
const MAX_BYTES = 4 * 1024 * 1024

/** The only filename shape this store issues, and therefore the only one it serves. */
const NAME = /^skin-[0-9a-f]{32}\.webp$/

/** webp's container signature: `RIFF....WEBP`. */
const RIFF = 'RIFF'
const WEBP = 'WEBP'

/**
 * Absolute path of one stored image.
 * @param name - filename previously issued by {@link storeSkinImage}.
 * @returns the path inside the harness home's skins directory.
 */
function imagePath(name: string): string {
  return join(dshHomePath(SKIN_STORE_DIR), name)
}

/**
 * Read a request body with a hard ceiling, destroying the connection rather
 * than buffering an unbounded upload.
 * @param req - the incoming request.
 * @returns the body, or null when it exceeded the ceiling.
 */
async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BYTES) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Write one uploaded image and return the name it is served under.
 * @param bytes - the webp body.
 * @returns the content-addressed filename.
 */
async function storeSkinImage(bytes: Buffer): Promise<string> {
  const name = `skin-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.webp`
  await mkdir(dshHomePath(SKIN_STORE_DIR), { recursive: true })
  // Re-uploading the same picture rewrites identical bytes, which is cheaper
  // than stat-ing first and removes the window where a concurrent read sees a
  // half-written file only to have it replaced by the same content.
  await writeFile(imagePath(name), bytes)
  return name
}

/**
 * Accept one uploaded background image.
 *
 * The body is raw webp rather than multipart: the browser produces it from a
 * canvas, so there is one part and no filename worth carrying, and a raw body
 * needs no parser on this side.
 * @param req - the incoming request.
 * @param res - the response to complete.
 */
export async function handleSkinUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end()
    return
  }
  const bytes = await readBody(req)
  if (bytes === null) {
    res.writeHead(413)
    res.end()
    return
  }
  // Sniff the container rather than trust the content type. This route writes
  // to the user's home directory, so what lands there should be what the route
  // claims to store even when the caller is confused or hostile.
  const isWebp = bytes.length > 12
    && bytes.subarray(0, 4).toString('latin1') === RIFF
    && bytes.subarray(8, 12).toString('latin1') === WEBP
  if (!isWebp) {
    res.writeHead(415, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'expected a webp image' }))
    return
  }
  const image = await storeSkinImage(bytes)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ image }))
}

/**
 * Serve one stored background image.
 * @param req - the incoming request.
 * @param res - the response to complete.
 */
export async function handleSkinImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  const name = pathname.startsWith(`${SKIN_IMAGE_ROUTE}/`)
    ? pathname.slice(SKIN_IMAGE_ROUTE.length + 1)
    : ''
  if (!NAME.test(name)) {
    res.writeHead(404)
    res.end()
    return
  }
  let bytes: Buffer
  try {
    bytes = await readFile(imagePath(name))
  } catch {
    // A settings document can outlive its image (a restored home, a manual
    // delete). Answering 404 leaves the veil painting over nothing, which is
    // the same as a skin without a hero — degraded, not broken.
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, {
    'content-type': 'image/webp',
    'content-length': String(bytes.length),
    // The name is the content hash, so this can never go stale.
    'cache-control': 'public, max-age=31536000, immutable',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(bytes)
}
