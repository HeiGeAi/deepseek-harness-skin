/** The Host routes that store and serve a custom skin's background image. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DSH_HOME_ENV } from '@deepseek-ai/dsh-home-paths'
import { handleSkinImage, handleSkinUpload, SKIN_STORE_DIR } from '../src/skin-store.ts'
import { SKIN_IMAGE_ROUTE, SKIN_UPLOAD_ROUTE } from '../src/skins/custom.ts'

/** What one call to a handler produced. */
interface Answer {
  /** HTTP status written. */
  status: number
  /** Headers written alongside it. */
  headers: Record<string, string>
  /** Body as written, if any. */
  body: Buffer | string | undefined
}

/** A minimal webp container: the signature this store sniffs, plus padding. */
function webp(marker = 'a'): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'latin1'),
    Buffer.from(marker.repeat(8), 'latin1'),
  ])
}

/**
 * Every fake request cuts off through this spy. Held here rather than on the
 * request object so a test can assert on it without taking a method off its
 * receiver.
 */
let destroyed = vi.fn()

/** A request whose body arrives in one chunk. */
function request(method: string, url: string, body?: Buffer): IncomingMessage {
  const req = {
    method,
    url,
    destroy: destroyed,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield body
    },
  }
  return req as unknown as IncomingMessage
}

/** A response that records what was written to it. */
function response(): { res: ServerResponse; answer: Answer } {
  const answer: Answer = { status: 0, headers: {}, body: undefined }
  const res = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      answer.status = status
      answer.headers = headers
    },
    end(chunk?: Buffer | string) {
      answer.body = chunk
    },
  } as unknown as ServerResponse
  return { res, answer }
}

let home = ''

beforeEach(async () => {
  destroyed = vi.fn()
  home = await mkdtemp(join(tmpdir(), 'dsh-skin-store-'))
  vi.stubEnv(DSH_HOME_ENV, home)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('handleSkinUpload', () => {
  it('refuses anything but a POST', async () => {
    const { res, answer } = response()
    await handleSkinUpload(request('GET', SKIN_UPLOAD_ROUTE), res)
    expect(answer.status).toBe(405)
    expect(answer.headers.allow).toBe('POST')
  })

  it('stores a webp under its content hash and reports the name', async () => {
    const { res, answer } = response()
    const bytes = webp()
    await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, bytes), res)
    expect(answer.status).toBe(200)
    const { image } = JSON.parse(String(answer.body)) as { image: string }
    expect(image).toMatch(/^skin-[0-9a-f]{32}\.webp$/)
    expect(await readFile(join(home, SKIN_STORE_DIR, image))).toEqual(bytes)
  })

  it('gives the same picture the same name twice', async () => {
    const names: string[] = []
    for (let i = 0; i < 2; i += 1) {
      const { res, answer } = response()
      await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, webp()), res)
      names.push((JSON.parse(String(answer.body)) as { image: string }).image)
    }
    expect(names[0]).toBe(names[1])
  })

  it('gives different pictures different names', async () => {
    const names: string[] = []
    for (const marker of ['a', 'b']) {
      const { res, answer } = response()
      await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, webp(marker)), res)
      names.push((JSON.parse(String(answer.body)) as { image: string }).image)
    }
    expect(names[0]).not.toBe(names[1])
  })

  it('rejects a body that is not a webp, whatever it claims to be', async () => {
    for (const bytes of [
      Buffer.from('<!doctype html><html></html>', 'latin1'),
      Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVEfmt ', 'latin1')]),
      Buffer.from('RIFF', 'latin1'),
    ]) {
      const { res, answer } = response()
      await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, bytes), res)
      expect(answer.status).toBe(415)
      expect(JSON.parse(String(answer.body))).toEqual({ error: 'expected a webp image' })
    }
  })

  it('cuts off an upload past the ceiling instead of buffering it', async () => {
    const { res, answer } = response()
    await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, Buffer.alloc(5 * 1024 * 1024)), res)
    expect(answer.status).toBe(413)
    expect(destroyed).toHaveBeenCalled()
  })
})

describe('handleSkinImage', () => {
  /** Put one image in the store and return the name it took. */
  async function stored(): Promise<string> {
    const { res, answer } = response()
    await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, webp()), res)
    return (JSON.parse(String(answer.body)) as { image: string }).image
  }

  it('refuses anything but a read', async () => {
    const { res, answer } = response()
    await handleSkinImage(request('POST', `${SKIN_IMAGE_ROUTE}/x.webp`), res)
    expect(answer.status).toBe(405)
    expect(answer.headers.allow).toBe('GET, HEAD')
  })

  it('serves the stored bytes back with an immutable cache header', async () => {
    const name = await stored()
    const { res, answer } = response()
    await handleSkinImage(request('GET', `${SKIN_IMAGE_ROUTE}/${name}`), res)
    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toBe('image/webp')
    expect(answer.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(answer.body).toEqual(webp())
    expect(answer.headers['content-length']).toBe(String(webp().length))
  })

  it('answers a HEAD with the headers and no body', async () => {
    const name = await stored()
    const { res, answer } = response()
    await handleSkinImage(request('HEAD', `${SKIN_IMAGE_ROUTE}/${name}`), res)
    expect(answer.status).toBe(200)
    expect(answer.headers['content-length']).toBe(String(webp().length))
    expect(answer.body).toBeUndefined()
  })

  it('serves nothing but the names it issues', async () => {
    // Traversal, a name outside the pattern, and a path off the route prefix
    // all reduce to the same answer, because only the issued shape is served.
    for (const url of [
      `${SKIN_IMAGE_ROUTE}/${encodeURIComponent('../../settings.yaml')}`,
      `${SKIN_IMAGE_ROUTE}/settings.yaml`,
      `${SKIN_IMAGE_ROUTE}/skin-0000.webp`,
      '/api/ui-theme/elsewhere/skin-00000000000000000000000000000000.webp',
    ]) {
      const { res, answer } = response()
      await handleSkinImage(request('GET', url), res)
      expect(answer.status).toBe(404)
    }
  })

  it('answers 404 when the document outlives its image', async () => {
    const name = await stored()
    await rm(join(home, SKIN_STORE_DIR, name))
    const { res, answer } = response()
    await handleSkinImage(request('GET', `${SKIN_IMAGE_ROUTE}/${name}`), res)
    expect(answer.status).toBe(404)
  })

  it('serves an image written straight into the store', async () => {
    // The read route is content-addressed by name, not by a registry, so a
    // restored home works without the upload route ever having run here.
    const name = 'skin-00000000000000000000000000000000.webp'
    const { res: seed } = response()
    await handleSkinUpload(request('POST', SKIN_UPLOAD_ROUTE, webp()), seed)
    await writeFile(join(home, SKIN_STORE_DIR, name), webp('z'))
    const { res, answer } = response()
    await handleSkinImage(request('GET', `${SKIN_IMAGE_ROUTE}/${name}`), res)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual(webp('z'))
  })
})
