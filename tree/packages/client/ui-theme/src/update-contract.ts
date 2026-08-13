/**
 * What the update check's two sides agree on.
 *
 * Kept apart from `update-check.ts` because that file is the Host half and
 * reaches for `node:fs` and `node:http`; the browser needs the route and the
 * result shape without dragging either into the client bundle.
 */

/** Route the browser reads the version from, and asks for a check on. */
export const UPDATE_CHECK_ROUTE = '/api/ui-theme/update-check'

/** Query flag that turns a free version read into a real network check. */
export const UPDATE_CHECK_FLAG = 'check'

/** What the Host reports about versions. */
export interface UpdateReport {
  /** The running skin system version. This is the one the check compares. */
  current: string
  /** The harness this skin system is installed into, shown but never compared. */
  harness: string
  /** The latest published skin system version, or null when nothing was compared. */
  latest: string | null
  /**
   * Whether an upgrade exists. `unavailable` is both "the check failed" and
   * "nothing was checked yet", because neither state offers a verdict and the
   * row renders them the same way.
   */
  state: 'current' | 'outdated' | 'unavailable'
}
