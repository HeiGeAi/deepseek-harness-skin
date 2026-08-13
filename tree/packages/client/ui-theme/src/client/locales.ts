/**
 * `settings.theme` namespace dictionaries (the Appearance row's copy).
 *
 * Skin labels are not written here. Each skin's display name lives in its own
 * `styles/skins/themes/<id>.json` next to the colours it names, so the picker
 * copy arrives through the generated manifest and adding a skin cannot leave a
 * dictionary half-updated.
 */

import { SKIN_MANIFEST, type GeneratedSkinId } from '../styles/skins/generated/manifest.ts'

/** Locales every skin declares a name in. */
type SkinLocale = 'zh' | 'en'

/** Per-skin picker labels for one locale, keyed as settings.theme entries. */
type SkinLabels = Record<`appearance.skin.${GeneratedSkinId}`, string>

/**
 * Project the manifest's names into dictionary entries.
 * @param locale - which declared name to read.
 * @returns one `appearance.skin.<id>` entry per generated skin.
 */
function skinLabels(locale: SkinLocale): SkinLabels {
  return Object.fromEntries(
    Object.entries(SKIN_MANIFEST).map(([id, skin]) => [`appearance.skin.${id}`, skin.name[locale]]),
  ) as SkinLabels
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'appearance.skin': '皮肤',
  'appearance.skin.none': '默认',
  'appearance.skin.custom': '自定义',
  'appearance.skin.custom.empty': '自定义（选图）',
  'appearance.skin.custom.working': '取色中…',
  'appearance.skin.custom.failed': '换张图试试',
  'appearance.skin.custom.hint': '选一张图，整套配色跟着它走；已选中时再点可换图',
  'appearance.version': '皮肤系统',
  'appearance.version.check': '检查更新',
  'appearance.version.checking': '正在检查…',
  'appearance.version.current': '已是最新版',
  'appearance.version.outdated': '发现新版本',
  'appearance.version.failed': '暂时无法检查',
  'appearance.version.copy': '复制更新指令',
  'appearance.version.copied': '指令已复制，粘贴给 agent 执行',
  'appearance.version.copyFailed': '复制失败，再试一次',
  ...skinLabels('zh'),
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.skin': 'Skin',
  'appearance.skin.none': 'Default',
  'appearance.skin.custom': 'Custom',
  'appearance.skin.custom.empty': 'Custom (pick)',
  'appearance.skin.custom.working': 'Reading colours…',
  'appearance.skin.custom.failed': 'Try another image',
  'appearance.skin.custom.hint': 'Pick an image and the whole palette follows it; click again while active to replace it',
  'appearance.version': 'Skin system',
  'appearance.version.check': 'Check for updates',
  'appearance.version.checking': 'Checking…',
  'appearance.version.current': 'Up to date',
  'appearance.version.outdated': 'Update available',
  'appearance.version.failed': 'Could not check right now',
  'appearance.version.copy': 'Copy update instruction',
  'appearance.version.copied': 'Copied — paste it to your agent',
  'appearance.version.copyFailed': 'Copy failed, try again',
  ...skinLabels('en'),
} satisfies Record<ThemeKey, string>
