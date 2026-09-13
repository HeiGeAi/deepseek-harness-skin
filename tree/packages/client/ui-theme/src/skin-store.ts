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
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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

/**
 * Most images the store holds. The upload route answers to any process that
 * can reach the Host port, and content addressing only dedupes identical
 * bytes, so without a ceiling a hostile local process could fill the disk one
 * random picture at a time.
 */
const MAX_FILES = 64

/** Most bytes the store may hold in total, counting what is already there. */
const MAX_TOTAL_BYTES = MAX_FILES * MAX_BYTES

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
 * The content-addressed name one body is stored and served under.
 * @param bytes - the webp body.
 * @returns the filename.
 */
function skinImageName(bytes: Buffer): string {
  return `skin-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.webp`
}

/**
 * Whether the store can take one more image of this size.
 *
 * Re-uploading a picture already stored rewrites identical bytes, so it never
 * counts against the ceiling; only a genuinely new image does.
 * @param name - the name the upload would be stored under.
 * @param size - the upload's size in bytes.
 * @returns whether the write stays within the store's ceiling.
 */
async function hasRoom(name: string, size: number): Promise<boolean> {
  const dir = dshHomePath(SKIN_STORE_DIR)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    // No directory yet means nothing stored, which always has room.
    return true
  }
  if (entries.includes(name)) return true
  if (entries.length >= MAX_FILES) return false
  let total = size
  for (const entry of entries) {
    /* v8 ignore next 3 -- a concurrent manual delete between readdir and stat. */
    try {
      total += (await stat(join(dir, entry))).size
    } catch { continue }
    if (total > MAX_TOTAL_BYTES) return false
  }
  return true
}

/**
 * Write one uploaded image and return the name it is served under.
 * @param bytes - the webp body.
 * @returns the content-addressed filename.
 */
async function storeSkinImage(bytes: Buffer): Promise<string> {
  const name = skinImageName(bytes)
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
  if (!await hasRoom(skinImageName(bytes), bytes.length)) {
    res.writeHead(507, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'skin image store is full' }))
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
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    // A malformed percent-encoding (e.g. `%zz`) raises URIError out of
    // decodeURIComponent. Answering 404 keeps one junk request from becoming
    // an unhandled rejection that takes the Host process down.
    res.writeHead(404)
    res.end()
    return
  }
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
