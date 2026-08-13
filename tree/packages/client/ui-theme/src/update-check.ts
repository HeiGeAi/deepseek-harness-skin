/**
 * Host-side "is there a newer skin system?" check.
 *
 * Deliberately small and deliberately manual. It never runs on a timer, never
 * runs at boot, and never installs anything — one user click, one request, one
 * answer. Everything that could turn that into background network traffic is
 * left out on purpose. Installing is left out too: this tree is a working copy
 * someone may have edited, and an auto-updater would quietly overwrite that.
 *
 * The version compared is the skin system's own ({@link SKIN_VERSION}), against
 * the latest published release of its repository. DSH's version rides along in
 * the report because the row shows it, but nothing compares it — the harness
 * updates on its own schedule through its own tooling.
 *
 * Every failure mode — offline, timeout, rate limit, non-200, oversized body,
 * malformed JSON, unparseable tag, no release cut yet — collapses into one
 * `unavailable` result. The caller gets a retry button, not a taxonomy of
 * network errors.
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { SKIN_REPO, SKIN_VERSION } from './skin-version.ts'
import { UPDATE_CHECK_FLAG, type UpdateReport } from './update-contract.ts'

/** The release feed this check reads; fixed, never caller-supplied. */
const RELEASE_URL = `https://api.github.com/repos/${SKIN_REPO}/releases/latest`

/** Hostname the response is required to have come from, redirects included. */
const RELEASE_HOST = 'api.github.com'

/** How long the registry gets before the check gives up. */
const TIMEOUT_MS = 3_000

/** Largest response read. A release payload is a few KiB. */
const MAX_BYTES = 64 * 1024

/** How long a successful answer is reused, so repeated clicks cost one request. */
const CACHE_MS = 60_000

/** `MAJOR.MINOR.PATCH` with an optional dot-separated prerelease, no build metadata. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/i

/** A version split into the parts SemVer orders by. */
interface Parsed {
  release: [number, number, number]
  prerelease: string[]
}

/**
 * Parse a strict release version.
 * @param value - the candidate string.
 * @returns its parts, or null when it is not a version this check will compare.
 */
function parseVersion(value: string): Parsed | null {
  const m = SEMVER.exec(value.trim())
  if (m === null) return null
  const tail = m[4]
  return {
    // The three release groups are not optional in the pattern, so a match
    // always carries all of them.
    release: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: tail === undefined ? [] : tail.split('.'),
  }
}

/**
 * Order two prerelease identifiers by SemVer's rules: numeric identifiers
 * compare numerically and rank below alphanumeric ones, which compare by ASCII.
 * @param a - one identifier.
 * @param b - the other.
 * @returns negative, zero or positive, in the usual comparator sense.
 */
function compareIdentifier(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Order two versions by SemVer precedence.
 *
 * The prerelease rules matter here rather than being pedantry: DSH ships as
 * `0.1.0-rc.N`, so a naive release-triple comparison would call every rc equal
 * to every other and never report an upgrade.
 * @param a - one version.
 * @param b - the other.
 * @returns negative when `a` precedes `b`, zero when equal, positive otherwise;
 *   null when either side is not a version this check will compare.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  // Destructured rather than indexed: the tuples are fixed-length, so this is
  // the shape that needs no defaults for reads that cannot miss.
  const [aMajor, aMinor, aPatch] = left.release
  const [bMajor, bMinor, bPatch] = right.release
  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  if (aPatch !== bPatch) return aPatch - bPatch
  // A version with a prerelease ranks below the same release without one.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length
  }
  for (const [i, mine] of left.prerelease.entries()) {
    const theirs = right.prerelease[i]
    // The shorter run has run out, which is itself the answer below.
    if (theirs === undefined) break
    const order = compareIdentifier(mine, theirs)
    if (order !== 0) return order
  }
  return left.prerelease.length - right.prerelease.length
}

/**
 * The harness version this skin system is installed into, read from this
 * package's checked-in manifest.
 *
 * Both the source tree (`src/`) and the built output (`lib/`) sit one level
 * under the package root, so the same relative hop resolves from either.
 * @returns the version, or null when the manifest is missing or malformed.
 */
async function harnessVersion(): Promise<string | null> {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url))
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    /* v8 ignore next -- the manifest ships inside the package. */
    return null
  }
}

/**
 * Ask GitHub for the latest published release tag.
 *
 * `releases/latest` skips drafts and prereleases by definition, so a tag that
 * comes back is one that was meant to be installed.
 * @returns the version behind the `v` prefix, or null on any failure at all.
 */
async function publishedVersion(): Promise<string | null> {
  const abort = new AbortController()
  const timer = setTimeout(() => { abort.abort() }, TIMEOUT_MS)
  try {
    const res = await fetch(RELEASE_URL, {
      signal: abort.signal,
      headers: { accept: 'application/vnd.github+json' },
    })
    // A redirect that leaves the API is not an answer this check trusts.
    if (!res.ok || new URL(res.url).hostname !== RELEASE_HOST) return null
    const length = Number(res.headers.get('content-length') ?? '0')
    if (length > MAX_BYTES) return null
    const body = await res.text()
    if (body.length > MAX_BYTES) return null
    const release = JSON.parse(body) as { tag_name?: unknown }
    const tag = release.tag_name
    if (typeof tag !== 'string') return null
    return tag.startsWith('v') ? tag.slice(1) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Last successful answer, reused while fresh. Process-local, never persisted. */
let cached: { at: number; report: UpdateReport } | undefined

/** The check currently in flight, so concurrent clicks share one request. */
let inFlight: Promise<UpdateReport> | undefined

/**
 * Run the check, or join the one already running.
 * @returns what to tell the browser.
 */
export async function checkForUpdate(): Promise<UpdateReport> {
  const fresh = cached
  if (fresh !== undefined && Date.now() - fresh.at < CACHE_MS) return fresh.report
  inFlight ??= (async (): Promise<UpdateReport> => {
    try {
      const [harness, published] = await Promise.all([harnessVersion(), publishedVersion()])
      const base = { current: SKIN_VERSION, harness: harness ?? 'unknown' }
      const order = published === null ? null : compareVersions(SKIN_VERSION, published)
      if (order === null) return { ...base, latest: null, state: 'unavailable' }
      const report: UpdateReport = {
        ...base,
        latest: published,
        state: order < 0 ? 'outdated' : 'current',
      }
      // Only a real answer is worth caching; a failure should be retryable at once.
      cached = { at: Date.now(), report }
      return report
    } finally {
      inFlight = undefined
    }
  })()
  return inFlight
}

/**
 * Report the running version without touching the network.
 *
 * The appearance row shows the version as soon as it opens, so it needs an
 * answer that costs nothing. Keeping that on the same route as the real check,
 * behind a query flag, is what makes "never goes online on its own" a property
 * of the code rather than a promise: the only caller that can reach the
 * registry is the one that passed the flag, and the only thing that passes it
 * is the button.
 * @returns the version, with no verdict attached.
 */
export async function readVersion(): Promise<UpdateReport> {
  return {
    current: SKIN_VERSION,
    harness: await harnessVersion() ?? 'unknown',
    latest: null,
    state: 'unavailable',
  }
}

/**
 * Answer one version read or update check.
 * @param req - the incoming request.
 * @param res - the response to complete.
 */
export async function handleUpdateCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' })
    res.end()
    return
  }
  /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
  const url = new URL(req.url ?? '/', 'http://x')
  const report = url.searchParams.get(UPDATE_CHECK_FLAG) === '1' ? await checkForUpdate() : await readVersion()
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(report))
}
