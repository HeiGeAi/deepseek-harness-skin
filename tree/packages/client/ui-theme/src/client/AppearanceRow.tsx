/**
 * Appearance preference row registered into the General section item slot:
 * title + three preference cubes + the deepseek-harness-skin picker.
 * Registered by this package — the theme feature owns its own settings
 * surface. Selection follows the persisted preference, never the resolved
 * active theme.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { CUSTOM_SKIN, SKINS, type SkinId, type ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import { fetchUpdateReport, updateInstruction } from './update-check.ts'
import type { UpdateReport } from '../update-contract.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference and skin writes (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Switch the visual skin. */
  setSkin: (id: SkinId) => void
  /**
   * Derive a skin from one picked image, store it, and select it. Rejects when
   * the image cannot be decoded or stored; the row surfaces that in place.
   */
  setCustomImage: (file: File) => Promise<void>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/** Skin picker entries, in registry order. */
const SKIN_ENTRIES: readonly { id: SkinId; labelKey: ThemeKey }[] = SKINS.map(skin => ({
  id: skin,
  labelKey: `appearance.skin.${skin}` as ThemeKey,
}))

/** What the custom entry is doing right now. */
type CustomState = 'idle' | 'working' | 'failed'

/**
 * What the version bar is doing right now.
 *
 * `idle` is the resting state whether or not a check has ever run — the version
 * is shown, no verdict is claimed. Everything past it is the result of a click.
 */
type VersionState = 'idle' | 'checking' | 'current' | 'outdated' | 'failed' | 'copied' | 'copyFailed'

/**
 * The version bar: the skin system's version, and a check the user has to ask
 * for. Nothing here runs on mount except the free local version read.
 * @param props - the locale seat.
 * @param props.t - the settings.theme translator.
 * @returns the version bar element.
 */
function VersionBar({ t }: Pick<AppearanceRowComponentProps, 't'>) {
  const [report, setReport] = useState<UpdateReport | null>(null)
  const [state, setState] = useState<VersionState>('idle')

  useEffect(() => {
    // Reads the running version off the Host without going online. A component
    // that unmounts mid-flight must not write state, hence the live flag.
    let live = true
    void fetchUpdateReport(false).then((first) => {
      if (live) setReport(first)
    })
    return () => { live = false }
  }, [])

  const onCheck = (): void => {
    setState('checking')
    void fetchUpdateReport(true).then((next) => {
      setReport(next)
      setState(next.state === 'unavailable' ? 'failed' : next.state)
    })
  }

  const onCopy = (text: string): void => {
    void writeClipboard(text).then((ok) => {
      setState(ok ? 'copied' : 'copyFailed')
    })
  }

  // Once an upgrade is known, the button's job changes from finding out to
  // acting on it — and it keeps that job through the copy result states, so a
  // failed copy can be retried without re-running the check. Deriving the text
  // here rather than inside the handler is also what ties the two together: no
  // report, no instruction, and therefore no copy button to press.
  const instruction = report !== null
    && (state === 'outdated' || state === 'copied' || state === 'copyFailed')
    ? updateInstruction(report)
    : null

  // A Host that could not answer reports "unknown" for both versions. Printing
  // "vunknown · DSH unknown" would be worse than printing nothing, so an
  // unknown part drops out of the line and leaves the retry button behind.
  const version = report === null || report.current === 'unknown' ? '' : `v${report.current}`
  const harness = report === null || report.harness === 'unknown' ? '' : `DSH ${report.harness}`
  const upgrade = report?.latest ?? ''
  const message = state === 'checking'
    ? t('appearance.version.checking')
    : state === 'current'
      ? t('appearance.version.current')
      : state === 'outdated'
        ? `${t('appearance.version.outdated')} v${upgrade}`
        : state === 'failed'
          ? t('appearance.version.failed')
          : state === 'copied'
            ? t('appearance.version.copied')
            : state === 'copyFailed'
              ? t('appearance.version.copyFailed')
              : harness

  const head = version === '' ? t('appearance.version') : `${t('appearance.version')} ${version}`
  return (
    <div className={css.versionBar}>
      <span className={css.versionText}>{message === '' ? head : `${head} · ${message}`}</span>
      <button
        type="button"
        className={css.versionButton}
        disabled={state === 'checking' || state === 'current'}
        onClick={instruction === null ? onCheck : () => { onCopy(instruction) }}
      >
        {instruction === null ? t('appearance.version.check') : t('appearance.version.copy')}
      </button>
    </div>
  )
}

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, setSkin, setCustomImage, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const skin = useStore(s => s.skin)
  const hasCustom = useStore(s => s.hasCustom)
  const picker = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<CustomState>('idle')

  // One entry, two jobs. With no image yet there is nothing to select, so the
  // click has to mean "pick one"; once an image exists the click means "use
  // it", and re-clicking the already-active entry means "use a different one".
  // That covers make, switch to, and replace without a second control.
  const onCustomClick = (): void => {
    if (hasCustom && skin !== CUSTOM_SKIN) {
      setSkin(CUSTOM_SKIN)
      return
    }
    setState('idle')
    picker.current?.click()
  }

  const onPicked = (file: File | undefined): void => {
    if (file === undefined) return
    setState('working')
    setCustomImage(file).then(
      () => { setState('idle') },
      () => { setState('failed') },
    )
  }

  const customLabel = state === 'working'
    ? t('appearance.skin.custom.working')
    : state === 'failed'
      ? t('appearance.skin.custom.failed')
      : hasCustom ? t('appearance.skin.custom') : t('appearance.skin.custom.empty')

  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className={css.skinTitle}>{t('appearance.skin')}</div>
      <div className={css.cubeRow}>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          className={css.filePicker}
          onChange={(event) => {
            onPicked(event.target.files?.[0])
            // Clearing the input is what lets the same file be picked twice in
            // a row, which is exactly what happens after a failed attempt.
            event.target.value = ''
          }}
        />
        {SKIN_ENTRIES.map(({ id, labelKey }) => id === CUSTOM_SKIN
          ? (
            <button
              key={id}
              type="button"
              className={clsx(css.skinCube, skin === id && hasCustom && css.selected)}
              aria-pressed={skin === id && hasCustom}
              aria-busy={state === 'working'}
              disabled={state === 'working'}
              // Only claim the preview scope once there are rules behind it;
              // before that the swatch should read as the empty slot it is.
              data-skin-preview={hasCustom ? id : undefined}
              title={t('appearance.skin.custom.hint')}
              onClick={onCustomClick}
            >
              <span className={css.skinSwatch} aria-hidden="true" />
              {customLabel}
            </button>
          )
          : (
            <button
              key={id}
              type="button"
              className={clsx(css.skinCube, skin === id && css.selected)}
              aria-pressed={skin === id}
              // Carries the generated `[data-skin-preview]` scope, which is what
              // lets the swatch paint that skin's colours without activating it.
              data-skin-preview={id === 'none' ? undefined : id}
              onClick={() => { setSkin(id) }}
            >
              <span className={css.skinSwatch} aria-hidden="true" />
              {t(labelKey)}
            </button>
          ))}
      </div>
      <VersionBar t={t} />
    </div>
  )
}
