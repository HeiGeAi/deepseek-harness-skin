/**
 * The user's own skin, assembled from persisted seeds.
 *
 * A built-in skin's rules are a file on disk that the bundler resolves and the
 * browser downloads. A custom skin's rules cannot be: the seeds only exist once
 * the user has picked a photograph. So the same derivation runs at runtime and
 * the rules are injected as a stylesheet instead — twice over, by design. The
 * Host inlines them into the index response so the first paint is already
 * correct, and the browser rewrites the same element when the user picks a new
 * image, so the change lands without a reload.
 *
 * Both callers go through here, which is what keeps those two paths from
 * disagreeing about what `custom` looks like.
 */

import { deriveSkin, type SkinTheme } from './derive.ts'
import { renderSkinCss } from './render.ts'
import { STOCK } from '../styles/skins/generated/stock.ts'
import { CUSTOM_SKIN, type CustomSkin } from '../theme-settings.ts'

/** Route prefix under which the Host serves `~/.dsh/skins/`. */
export const SKIN_IMAGE_ROUTE = '/api/ui-theme/skins'

/** Route accepting one uploaded background image. */
export const SKIN_UPLOAD_ROUTE = '/api/ui-theme/skin-upload'

/** Id of the style element carrying the custom skin's rules. */
export const CUSTOM_SKIN_STYLE_ID = 'dsh-custom-skin'

/**
 * URL of a stored background image.
 * @param image - filename under `~/.dsh/skins/`.
 * @returns the absolute path the Host serves it on.
 */
export function skinImageUrl(image: string): string {
  return `${SKIN_IMAGE_ROUTE}/${encodeURIComponent(image)}`
}

/**
 * Widen the persisted settings shape into the theme definition the derivation
 * consumes. Same interface the built-in `themes/*.json` files satisfy, so the
 * custom skin enters the pipeline at exactly the point they do.
 * @param custom - the persisted custom skin.
 * @returns the theme definition.
 */
export function customSkinTheme(custom: CustomSkin): SkinTheme {
  return {
    id: CUSTOM_SKIN,
    appearance: custom.appearance,
    chrome: custom.chrome,
    seeds: custom.seeds,
    veil: custom.veil,
    // An empty image is the "no picture picked yet" state. Emitting a hero for
    // it would point the background at a URL the store has nothing behind, so
    // the theme simply has no hero until there is one.
    ...custom.image === '' ? {} : { hero: custom.image, heroFocus: custom.focus },
  }
}

/**
 * Derive and format the custom skin's rules.
 * @param custom - the persisted custom skin.
 * @returns CSS text, ready for a `<style>` element.
 */
export function customSkinCss(custom: CustomSkin): string {
  const theme = customSkinTheme(custom)
  return renderSkinCss(theme, deriveSkin(theme, STOCK), image => `url("${skinImageUrl(image)}")`)
}
