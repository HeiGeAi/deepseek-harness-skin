/**
 * The Host's version read and update check.
 *
 * Every case drives the real handler and asserts on what the browser would
 * receive, including that a plain version read never reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SKIN_REPO, SKIN_VERSION } from '../src/skin-version.ts'
import { UPDATE_CHECK_ROUTE, type UpdateReport } from '../src/update-contract.ts'

/** What one call to the handler produced. */
interface Answer {
  /** HTTP status written. */
  status: number
  /** Headers written alongside it. */
  headers: Record<string, string>
  /** Body, parsed when it is JSON. */
  body: UpdateReport | null
}

/** A fake release response. */
function release(
  body: unknown,
  init: { ok?: boolean; url?: string; length?: string | null } = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const declared = init.length === undefined ? String(text.length) : init.length
  return {
    ok: init.ok ?? true,
    url: init.url ?? `https://api.github.com/repos/${SKIN_REPO}/releases/latest`,
    headers: { get: (name: string) => name === 'content-length' ? declared : null },
    text: () => Promise.resolve(text),
  } as unknown as Response
}

/**
 * Drive the handler once against a fresh copy of the module, so the cache and
 * the in-flight slot start empty.
 * @param query - the request's query string, `?check=1` or empty.
 * @param method - the request method.
 * @param handler - the handler under test.
 * @returns what the handler wrote.
 */
async function call(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  query = '', method = 'GET',
): Promise<Answer> {
  const answer: Answer = { status: 0, headers: {}, body: null }
  const res = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      answer.status = status
      answer.headers = headers
    },
    end(chunk?: string) {
      answer.body = chunk === undefined ? null : JSON.parse(chunk) as UpdateReport
    },
  } as unknown as ServerResponse
  await handler({ method, url: `${UPDATE_CHECK_ROUTE}${query}` } as IncomingMessage, res)
  return answer
}

/** Load a fresh copy of the module, past the previous test's module state. */
async function load(): Promise<typeof import('../src/update-check.ts')> {
  vi.resetModules()
  return import('../src/update-check.ts')
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.doUnmock('node:fs/promises')
})

describe('compareVersions', () => {
  it('orders by the release triple first, one component at a time', async () => {
    const { compareVersions } = await load()
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a prerelease below the release it leads to', async () => {
    const { compareVersions } = await load()
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
  })

  it('applies SemVer prerelease rules, which is what separates two rcs', async () => {
    const { compareVersions } = await load()
    expect(compareVersions('0.1.0-rc.5', '0.1.0-rc.6')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.2')).toBe(0)
    // Numeric identifiers rank below alphanumeric ones, and a longer run of
    // identifiers ranks above its own prefix — from either side, so the walk
    // has to stop at whichever run runs out first.
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc', '1.0.0-rc.1')).toBeLessThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc')).toBeGreaterThan(0)
  })

  it('refuses to compare something that is not a version', async () => {
    const { compareVersions } = await load()
    expect(compareVersions('nightly', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', 'latest')).toBeNull()
    expect(compareVersions('1.0', '1.0.0')).toBeNull()
  })
})

describe('the version read', () => {
  it('answers without going online', async () => {
    const { handleUpdateCheck } = await load()
    const answer = await call(handleUpdateCheck)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(answer.status).toBe(200)
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(answer.body).toEqual({
      current: SKIN_VERSION,
      harness: expect.stringMatching(/^\d/) as string,
      latest: null,
      state: 'unavailable',
    })
  })

  it('says unknown when the manifest carries no version', async () => {
    vi.doMock('node:fs/promises', () => ({ readFile: () => Promise.resolve('{}') }))
    const { handleUpdateCheck } = await load()
    expect((await call(handleUpdateCheck)).body?.harness).toBe('unknown')
  })

  it('refuses anything but a GET', async () => {
    const { handleUpdateCheck } = await load()
    const answer = await call(handleUpdateCheck, '', 'POST')
    expect(answer.status).toBe(405)
    expect(answer.headers.allow).toBe('GET')
    expect(answer.body).toBeNull()
  })
})

describe('the update check', () => {
  it('reads the repository the skin system is published from', async () => {
    fetchMock.mockResolvedValue(release({ tag_name: `v${SKIN_VERSION}` }))
    const { handleUpdateCheck } = await load()
    await call(handleUpdateCheck, '?check=1')
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/${SKIN_REPO}/releases/latest`,
      expect.objectContaining({ headers: { accept: 'application/vnd.github+json' } }),
    )
  })

  it('reports being current when the published tag matches', async () => {
    fetchMock.mockResolvedValue(release({ tag_name: `v${SKIN_VERSION}` }))
    const { handleUpdateCheck } = await load()
    const answer = await call(handleUpdateCheck, '?check=1')
    expect(answer.body?.state).toBe('current')
    expect(answer.body?.latest).toBe(SKIN_VERSION)
  })

  it('reports an upgrade when a newer tag is published', async () => {
    fetchMock.mockResolvedValue(release({ tag_name: 'v99.0.0' }))
    const { handleUpdateCheck } = await load()
    const answer = await call(handleUpdateCheck, '?check=1')
    expect(answer.body?.state).toBe('outdated')
    expect(answer.body?.latest).toBe('99.0.0')
  })

  it('stays current when the published tag is older than what is running', async () => {
    fetchMock.mockResolvedValue(release({ tag_name: 'v0.0.1' }))
    const { handleUpdateCheck } = await load()
    expect((await call(handleUpdateCheck, '?check=1')).body?.state).toBe('current')
  })

  it('accepts a release whose size the server never declared', async () => {
    // No content-length at all is the chunked answer, not an oversized one.
    fetchMock.mockResolvedValue(release({ tag_name: 'v99.0.0' }, { length: null }))
    const { handleUpdateCheck } = await load()
    expect((await call(handleUpdateCheck, '?check=1')).body?.state).toBe('outdated')
  })

  it('still reports the verdict when the harness version cannot be read', async () => {
    vi.doMock('node:fs/promises', () => ({ readFile: () => Promise.resolve('{}') }))
    fetchMock.mockResolvedValue(release({ tag_name: 'v99.0.0' }))
    const { handleUpdateCheck } = await load()
    const answer = await call(handleUpdateCheck, '?check=1')
    expect(answer.body?.harness).toBe('unknown')
    expect(answer.body?.state).toBe('outdated')
  })

  for (const [name, response] of [
    ['a non-200 answer', release({ tag_name: 'v9.0.0' }, { ok: false })],
    ['a redirect off the API host', release({ tag_name: 'v9.0.0' }, { url: 'https://evil.test/x' })],
    ['a body the header says is oversized', release({ tag_name: 'v9.0.0' }, { length: '999999' })],
    ['a body that is oversized once read', release({ tag_name: `v9.0.0${'x'.repeat(70_000)}` }, { length: '10' })],
    ['a body that is not JSON', release('<!doctype html>')],
    ['a release with no tag', release({})],
    ['a tag that is not a release tag', release({ tag_name: 'nightly-2026-08-14' })],
    ['a tag that does not parse as a version', release({ tag_name: 'vlatest' })],
  ] as const) {
    it(`falls back to unavailable on ${name}`, async () => {
      fetchMock.mockResolvedValue(response)
      const { handleUpdateCheck } = await load()
      const answer = await call(handleUpdateCheck, '?check=1')
      expect(answer.status).toBe(200)
      expect(answer.body?.state).toBe('unavailable')
      expect(answer.body?.latest).toBeNull()
      // The running version is still reported; only the verdict is missing.
      expect(answer.body?.current).toBe(SKIN_VERSION)
    })
  }

  it('falls back to unavailable when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    const { handleUpdateCheck } = await load()
    expect((await call(handleUpdateCheck, '?check=1')).body?.state).toBe('unavailable')
  })

  it('gives up rather than hanging when the registry never answers', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const { handleUpdateCheck } = await load()
    const pending = call(handleUpdateCheck, '?check=1')
    await vi.advanceTimersByTimeAsync(3_000)
    expect((await pending).body?.state).toBe('unavailable')
  })

  it('serves repeated clicks from one request, and asks again once it goes stale', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(release({ tag_name: 'v99.0.0' }))
    const { handleUpdateCheck } = await load()
    await call(handleUpdateCheck, '?check=1')
    await call(handleUpdateCheck, '?check=1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 61_000)
    await call(handleUpdateCheck, '?check=1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('joins concurrent clicks onto the request already in flight', async () => {
    fetchMock.mockResolvedValue(release({ tag_name: 'v99.0.0' }))
    const { checkForUpdate } = await load()
    const [one, two] = await Promise.all([checkForUpdate(), checkForUpdate()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(one).toEqual(two)
  })

  it('does not cache a failure, so the retry button works', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(release({ tag_name: 'v99.0.0' }))
    const { checkForUpdate } = await load()
    expect((await checkForUpdate()).state).toBe('unavailable')
    expect((await checkForUpdate()).state).toBe('outdated')
  })
})
