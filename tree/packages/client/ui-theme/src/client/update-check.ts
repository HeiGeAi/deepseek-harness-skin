/**
 * Browser half of the update check: read the version, ask for a check, and
 * hand back an instruction the user can paste at an agent.
 *
 * No automatic install, on purpose. This is a skin system living inside someone
 * else's working tree, which they may well have edited; anything that installed
 * over it would quietly delete that. The most this offers is text describing
 * what to do.
 */

import { SKIN_REPO } from '../skin-version.ts'
import { UPDATE_CHECK_FLAG, UPDATE_CHECK_ROUTE, type UpdateReport } from '../update-contract.ts'

/** A report the row can render when the Host cannot be reached at all. */
const UNREACHABLE: UpdateReport = { current: 'unknown', harness: 'unknown', latest: null, state: 'unavailable' }

/**
 * Read the running version, or run a real check against the release feed.
 * @param online - whether to let the Host go online.
 * @returns the Host's report, degraded rather than thrown on any failure.
 */
export async function fetchUpdateReport(online: boolean): Promise<UpdateReport> {
  const url = online ? `${UPDATE_CHECK_ROUTE}?${UPDATE_CHECK_FLAG}=1` : UPDATE_CHECK_ROUTE
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return UNREACHABLE
    return await res.json() as UpdateReport
  } catch {
    return UNREACHABLE
  }
}

/**
 * The text offered when a newer version exists.
 *
 * It asks for the user's own skins and settings to survive, because this runs
 * inside a working tree rather than over a pristine install.
 * @param report - a report whose state is `outdated`.
 * @returns the instruction to paste.
 */
export function updateInstruction(report: UpdateReport): string {
  return [
    '请把这套 DeepSeek Harness Skin 更新到最新版：',
    `https://github.com/${SKIN_REPO}`,
    '',
    `当前皮肤系统版本：v${report.current}`,
    `最新发布版本：v${report.latest ?? 'unknown'}`,
    `当前 DSH 版本：${report.harness}`,
    '',
    '请先读仓库 README 和最新 Release，按项目给的安装方式更新。',
    '保留我已有的自定义皮肤和设置，更新后确认皮肤选择、自定义皮肤取色和背景图都正常。',
  ].join('\n')
}
