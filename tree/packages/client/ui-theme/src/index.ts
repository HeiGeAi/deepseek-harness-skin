/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { injectBootTheme } from './boot-theme.ts'
import { handleSkinImage, handleSkinUpload } from './skin-store.ts'
import { SKIN_IMAGE_ROUTE, SKIN_UPLOAD_ROUTE } from './skins/custom.ts'
import { handleUpdateCheck } from './update-check.ts'
import { UPDATE_CHECK_ROUTE } from './update-contract.ts'
import {
  DEFAULT_PREFERENCE, DEFAULT_SKIN, EMPTY_CUSTOM_SKIN, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type CustomSkin, type SkinId, type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

export {
  CUSTOM_SKIN, CUSTOM_SKIN_FIELD, DEFAULT_PREFERENCE, DEFAULT_SKIN, EMPTY_CUSTOM_SKIN, SKINS, SKIN_FIELD,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type CustomSkin, type SkinId, type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the registered preference or use the schema default without a settings provider. */
function readPreference(ctx: Context): ThemePreference {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_PREFERENCE
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return DEFAULT_PREFERENCE
  return section.preference
}

/** Read the registered skin or use the schema default without a settings provider. */
function readSkin(ctx: Context): SkinId {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_SKIN
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return DEFAULT_SKIN
  return section.skin
}

/**
 * Read the registered custom skin, or the empty one. A section written before
 * the field existed carries no custom skin, which reads the same as never
 * having made one.
 */
function readCustomSkin(ctx: Context): CustomSkin {
  const settings = ctx.get('settings')
  if (settings === undefined) return EMPTY_CUSTOM_SKIN
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  return section?.customSkin ?? EMPTY_CUSTOM_SKIN
}

/**
 * Register the durable theme section, the initial-theme index transform, and
 * the custom skin's image store when their optional Host services are composed.
 * @param ctx - Host context that may acquire settings and HTTP services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(
        html => injectBootTheme(html, readPreference(ctx), readSkin(ctx), readCustomSkin(ctx)),
      ),
      'client-ui-theme: initial theme bootstrap',
    )
    // The custom skin's photograph lives in the harness home rather than in the
    // settings document, so the browser needs one route to put it there and one
    // to read it back.
    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'exact', path: SKIN_UPLOAD_ROUTE, handler: handleSkinUpload }),
      'client-ui-theme: skin image upload',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'prefix', path: SKIN_IMAGE_ROUTE, handler: handleSkinImage }),
      'client-ui-theme: skin image route',
    )
    // Registering the route does not make the check run: nothing calls it until
    // the user presses the button in the appearance row.
    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'exact', path: UPDATE_CHECK_ROUTE, handler: handleUpdateCheck }),
      'client-ui-theme: update check',
    )
  })
}
