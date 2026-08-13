/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import {
  SKIN_MANIFEST,
  type GeneratedSkinId,
  type SkinAppearance,
  type SkinChrome,
  type SkinEntry,
} from './styles/skins/generated/manifest.ts'

/**
 * The manifest widened to an open key space. The lookups below sit behind the
 * settings boundary, where a persisted id can name a theme file this build no
 * longer generates; a view keyed by the id union would tell the compiler that
 * case is impossible and quietly turn the guard into dead code.
 */
const SKINS_BY_ID: Readonly<Record<string, SkinEntry | undefined>> = SKIN_MANIFEST

export type { SkinAppearance, SkinChrome }

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the selected skin id. */
export const SKIN_FIELD = 'skin'

/** Field carrying the user's own derived skin. */
export const CUSTOM_SKIN_FIELD = 'customSkin'

/** The one skin id whose palette is derived at runtime rather than at build time. */
export const CUSTOM_SKIN = 'custom'

/** Skin ids selectable from the Appearance row. */
export type SkinId = typeof CUSTOM_SKIN | 'none' | GeneratedSkinId

/**
 * Visual skins accepted at the registry and settings boundaries, in picker
 * order. `custom` leads because it is the one entry the user authors; `none`
 * renders the stock platform look; every other id comes from
 * `styles/skins/themes/*.json` by way of the generated manifest, already in
 * the curated picker order, so adding a skin never touches this file.
 */
export const SKINS: readonly SkinId[] = [
  CUSTOM_SKIN,
  'none',
  ...Object.keys(SKIN_MANIFEST) as GeneratedSkinId[],
]

/**
 * The user's own skin: four seeds read out of a photograph, the wash tuned
 * against it, and the filename of the image itself under `~/.dsh/skins/`.
 *
 * The derived palette is deliberately *not* stored. It is a pure function of
 * these fields, so persisting it would create a second copy that goes stale
 * the day the ramp algorithm changes; both the Host boot transform and the
 * browser re-derive from here instead.
 */
export interface CustomSkin {
  /** Filename under `~/.dsh/skins/`; empty when the user has not made one. */
  image: string
  /** The scheme the image's own brightness put it in. */
  appearance: SkinAppearance
  /** The chrome preset picked to suit that scheme. */
  chrome: SkinChrome
  /** Wash opacity over the image, tuned until body text cleared its threshold. */
  veil: number
  /** `background-position` for the image. */
  focus: string
  /** The four seeds extracted from the image. */
  seeds: { accent: string; secondary: string; surface: string; text: string }
}

/** An unmade custom skin: selectable ids stay stable, so absence is a value. */
export const EMPTY_CUSTOM_SKIN: CustomSkin = {
  image: '',
  appearance: 'light',
  chrome: 'glass',
  veil: 0.82,
  focus: '50% 50%',
  seeds: { accent: '#4d6bfe', secondary: '#8b95b5', surface: '#ffffff', text: '#141414' },
}

/** Durable shape of the user's own skin. */
export const CustomSkinSchema: z<CustomSkin> = z.object({
  image: z.string().default(EMPTY_CUSTOM_SKIN.image),
  appearance: z.union([z.const('light'), z.const('dark')]).default(EMPTY_CUSTOM_SKIN.appearance),
  chrome: z.union([z.const('flat'), z.const('glass'), z.const('neon')]).default(EMPTY_CUSTOM_SKIN.chrome),
  veil: z.number().min(0).max(1).default(EMPTY_CUSTOM_SKIN.veil),
  focus: z.string().default(EMPTY_CUSTOM_SKIN.focus),
  seeds: z.object({
    accent: z.string().default(EMPTY_CUSTOM_SKIN.seeds.accent),
    secondary: z.string().default(EMPTY_CUSTOM_SKIN.seeds.secondary),
    surface: z.string().default(EMPTY_CUSTOM_SKIN.seeds.surface),
    text: z.string().default(EMPTY_CUSTOM_SKIN.seeds.text),
  }),
})

/**
 * Whether a custom skin has an image behind it. Everything downstream keys off
 * this rather than off the id, because `custom` stays a selectable id even
 * before the user has made one and after they delete the image.
 * @param custom - the persisted custom skin, if the document carries one.
 * @returns whether the skin can actually paint.
 */
export function hasCustomSkin(custom: CustomSkin | undefined): custom is CustomSkin {
  return custom !== undefined && custom.image !== ''
}

/**
 * Whether two custom skins would paint identically.
 *
 * Comparison is by value, not by reference: the settings scope decodes a fresh
 * section object on every write in the namespace, so a reference check would
 * report "changed" whenever the user merely toggled light/dark and send the
 * whole derivation and a stylesheet rewrite through again.
 * @param a - one custom skin.
 * @param b - the other.
 * @returns whether every field that reaches the stylesheet matches.
 */
export function sameCustomSkin(a: CustomSkin, b: CustomSkin): boolean {
  return a.image === b.image && a.appearance === b.appearance && a.chrome === b.chrome
    && a.veil === b.veil && a.focus === b.focus
    && a.seeds.accent === b.seeds.accent && a.seeds.secondary === b.seeds.secondary
    && a.seeds.surface === b.seeds.surface && a.seeds.text === b.seeds.text
}

/**
 * The colour scheme a skin pins the UI to, or `null` for the stock look, which
 * is the only value that defers to the user's light/dark preference.
 *
 * A skin declares this in its theme file and the generator derives that
 * scheme's ramp from it, so honouring it here is what makes a skin marked
 * `dark` actually paint dark tokens instead of dark-looking colours over a
 * light semantic layer.
 *
 * Both lookups are total on purpose. They sit behind the settings boundary,
 * where a document can still carry a skin id this build no longer generates
 * (a renamed or removed theme file), and degrading such a value to the stock
 * look is the right failure mode — throwing would take the whole snapshot
 * down with it.
 * The custom skin resolves from the settings document instead of the manifest,
 * and degrades to the stock look when there is no image behind it — selecting
 * `custom` before making one is a normal state, not a broken document.
 * @param skin - selected skin id.
 * @param custom - the persisted custom skin, when the document carries one.
 * @returns the pinned appearance, or null when nothing is pinned.
 */
export function skinAppearance(skin: SkinId, custom?: CustomSkin): SkinAppearance | null {
  if (skin === CUSTOM_SKIN) return hasCustomSkin(custom) ? custom.appearance : null
  return SKINS_BY_ID[skin]?.appearance ?? null
}

/**
 * Which shared chrome treatment a skin wears, or `null` for the stock look.
 * @param skin - selected skin id.
 * @param custom - the persisted custom skin, when the document carries one.
 * @returns the preset name consumed by `data-skin-chrome`, or null.
 */
export function skinChrome(skin: SkinId, custom?: CustomSkin): SkinChrome | null {
  if (skin === CUSTOM_SKIN) return hasCustomSkin(custom) ? custom.chrome : null
  return SKINS_BY_ID[skin]?.chrome ?? null
}

/** Default skin when the user-settings document has no override. */
export const DEFAULT_SKIN: SkinId = 'qq-2008'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Selected visual skin. */
  skin: SkinId
  /** The user's own skin, empty until they make one. */
  customSkin: CustomSkin
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [SKIN_FIELD]: z.union([...SKINS]).default(DEFAULT_SKIN),
  [CUSTOM_SKIN_FIELD]: CustomSkinSchema.default(EMPTY_CUSTOM_SKIN),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Narrow one wire or registry value to a persistable skin id.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in skin id.
 */
export function isSkinId(value: unknown): value is SkinId {
  return SKINS.some(skin => skin === value)
}
