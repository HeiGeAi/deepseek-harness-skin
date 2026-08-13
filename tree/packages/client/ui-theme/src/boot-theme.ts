/**
 * Host-rendered theme bootstrap for the browser's pre-plugin interval. Each
 * index response embeds the current durable built-in preference and skin;
 * the browser resolves only `system`, then writes the same DOM fields
 * ui-layout's ThemePresenter owns after the client plugin tree activates.
 */

import { CUSTOM_SKIN_STYLE_ID, customSkinCss } from './skins/custom.ts'
import {
  DEFAULT_PREFERENCE,
  DEFAULT_SKIN,
  EMPTY_CUSTOM_SKIN,
  hasCustomSkin,
  skinAppearance,
  skinChrome,
  type CustomSkin,
  type SkinId,
  type ThemePreference,
} from './theme-settings.ts'

/**
 * Build the inline script for one schema-validated built-in preference + skin.
 *
 * The scheme is decided here rather than in the browser. A skin declares the
 * appearance its palette was generated for, so the browser only has anything
 * left to resolve in the one case that genuinely depends on it: the stock look
 * under a `system` preference. Emitting the decided branch also keeps the
 * bootstrap free of a dead half.
 * @param preference - current Host-backed built-in preference.
 * @param skin - current Host-backed skin id.
 * @param custom - current Host-backed custom skin.
 * @returns the inline script tag.
 */
function bootThemeScript(preference: ThemePreference, skin: SkinId, custom: CustomSkin): string {
  const appearance = skinAppearance(skin, custom)
  const dark = appearance !== null
    ? String(appearance === 'dark')
    : `${JSON.stringify(preference)} === 'dark'
    || (${JSON.stringify(preference)} === 'system'
      && typeof matchMedia !== 'undefined'
      && matchMedia('(prefers-color-scheme: dark)').matches)`
  // The chrome attribute carries the shared component skeleton (_chrome.css);
  // the skin attribute carries that skin's palette. Both, or neither.
  const attributes = appearance !== null
    ? `  document.body.setAttribute('data-dsh-skin', ${JSON.stringify(skin)})
  document.body.setAttribute('data-skin-chrome', ${JSON.stringify(skinChrome(skin, custom))})`
    : `  document.body.removeAttribute('data-dsh-skin')
  document.body.removeAttribute('data-skin-chrome')`
  return `<script>(() => {
  const dark = ${dark}
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
${attributes}
})()</script>`
}

/**
 * Build the custom skin's stylesheet element, or nothing when the user has not
 * made one.
 *
 * Built-in skins ship their rules in the bundle, so the browser has them before
 * it has the boot script. The custom skin's rules exist only as a function of
 * the settings document, so they are derived per index response and inlined
 * here — same reason the attributes are written inline rather than by the
 * plugin: a skin that arrives after first paint is a flash of the wrong skin.
 *
 * The element is emitted whenever an image exists, not only while `custom` is
 * the selected skin, because the picker paints its swatch from the same rules
 * through `[data-skin-preview='custom']`.
 * @param custom - current Host-backed custom skin.
 * @returns the style tag, or an empty string.
 */
function bootThemeStyle(custom: CustomSkin): string {
  if (!hasCustomSkin(custom)) return ''
  // Derived from hex, numbers and a sanitized filename, so no sequence here can
  // close the element; the replace is belt-and-braces against a future field
  // reaching this string without passing the upload route's checks.
  const css = customSkinCss(custom).replace(/<\//g, '<\\/')
  return `<style id="${CUSTOM_SKIN_STYLE_ID}">${css}</style>`
}

/**
 * Insert the theme bootstrap immediately after the opening body tag, before
 * the shell mount and module script. Body-less fragments receive it at the
 * end, where the HTML parser has already synthesized a body.
 * @param html - Raw application index HTML.
 * @param preference - Current Host-backed built-in preference.
 * @param skin - Current Host-backed skin id.
 * @param custom - Current Host-backed custom skin.
 * @returns HTML containing the theme bootstrap.
 */
export function injectBootTheme(
  html: string,
  preference: ThemePreference = DEFAULT_PREFERENCE,
  skin: SkinId = DEFAULT_SKIN,
  custom: CustomSkin = EMPTY_CUSTOM_SKIN,
): string {
  const boot = `${bootThemeStyle(custom)}${bootThemeScript(preference, skin, custom)}`
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${boot}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${boot}${html.slice(at)}`
}
