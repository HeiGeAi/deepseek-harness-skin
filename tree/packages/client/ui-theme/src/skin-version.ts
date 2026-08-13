/**
 * The skin system's own version.
 *
 * Deliberately not the workspace version. Every package in this monorepo
 * carries DSH's release number (`0.1.0-rc.N`), and the skin system ships on its
 * own cadence as a separate project — so it needs a number that can move when a
 * skin is added without pretending the whole harness was released.
 *
 * This constant is the single source of truth. The release tag on GitHub is
 * `v${SKIN_VERSION}`, and the update check compares against exactly that.
 */

/** Current skin system version, as a strict three-part release. */
export const SKIN_VERSION = '1.0.0'

/** Owner/name of the repository releases are cut from. */
export const SKIN_REPO = 'HeiGeAi/deepseek-harness-skin'
