/**
 * Appearance row slot store: a mirror of the theme service snapshot. The
 * plugin's apply-world change listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkinId, ThemePreference } from '../theme-settings.ts'

/** Store state mirrored from the theme snapshot and skin settings. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Persisted skin id (deepseek-harness-skin selection state). */
  skin: SkinId
  /**
   * Whether the user has made a custom skin. The picker needs this separately
   * from the id: `custom` stays selectable before any image exists, and the
   * entry behaves differently depending on whether one does.
   */
  hasCustom: boolean
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, preference: ThemePreference, revision: number) => void
  syncSkin: (draft: AppearanceRowState, skin: SkinId, hasCustom: boolean) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({
      preference: 'system', skin: 'qq-2008', hasCustom: false, revision: -1,
    }),
    actions: {
      sync: (d, preference: ThemePreference, revision: number) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.revision = revision
      },
      syncSkin: (d, skin: SkinId, hasCustom: boolean) => {
        d.skin = skin
        d.hasCustom = hasCustom
      },
    },
  })
}
