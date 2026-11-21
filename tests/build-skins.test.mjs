import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SOURCE_UI_THEME = join(REPO_ROOT, 'tree', 'packages', 'client', 'ui-theme')

function snapshotTree(root) {
  const entries = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        entries[relative(root, full)] = readFileSync(full)
      }
    }
  }
  walk(root)
  return entries
}

function withTempCopy(fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-build-skins-'))
  const copy = join(scratch, 'ui-theme')
  cpSync(SOURCE_UI_THEME, copy, { recursive: true })
  try {
    return fn(copy)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function runCheck(uiThemeDir) {
  return spawnSync(process.execPath, ['scripts/build-skins.mjs', '--check'], {
    cwd: uiThemeDir,
    encoding: 'utf8',
  })
}

test('build-skins --check succeeds on clean copy and leaves files untouched', () => {
  withTempCopy((dir) => {
    const before = snapshotTree(dir)
    const res = runCheck(dir)
    assert.equal(res.status, 0, res.stdout + res.stderr)
    assert.match(res.stdout, /21 份主题定义一致/)
    assert.match(res.stdout, /21 个皮肤 × 8 项可读性契约全部达标/)
    assert.deepEqual(snapshotTree(dir), before)
  })
})

test('build-skins --check fails on missing generated file without mutating tree', () => {
  withTempCopy((dir) => {
    const missingFile = join(dir, 'src/styles/skins/generated/miku.css')
    rmSync(missingFile)
    const before = snapshotTree(dir)
    const res = runCheck(dir)
    assert.equal(res.status, 1, res.stdout + res.stderr)
    assert.match(res.stderr, /drift:.*miku\.css/)
    assert.deepEqual(snapshotTree(dir), before)
  })
})

test('build-skins --check fails on drifted generated file without mutating tree', () => {
  withTempCopy((dir) => {
    const driftedFile = join(dir, 'src/styles/skins/generated/qq-2007.css')
    writeFileSync(driftedFile, `${readFileSync(driftedFile, 'utf8')}\n/* drift */\n`)
    const before = snapshotTree(dir)
    const res = runCheck(dir)
    assert.equal(res.status, 1, res.stdout + res.stderr)
    assert.match(res.stderr, /drift:.*qq-2007\.css/)
    assert.deepEqual(snapshotTree(dir), before)
  })
})

test('build-skins --check fails on orphan generated file without deleting it', () => {
  withTempCopy((dir) => {
    const orphanFile = join(dir, 'src/styles/skins/generated/orphan-skin.css')
    writeFileSync(orphanFile, '/* orphan */\n')
    const before = snapshotTree(dir)
    const res = runCheck(dir)
    assert.equal(res.status, 1, res.stdout + res.stderr)
    assert.match(res.stderr, /残留:.*orphan-skin\.css/)
    assert.deepEqual(snapshotTree(dir), before)
  })
})

test('build-skins --check reports drift cleanly when generated directory is absent', () => {
  withTempCopy((dir) => {
    rmSync(join(dir, 'src/styles/skins/generated'), { recursive: true, force: true })
    const before = snapshotTree(dir)
    const res = runCheck(dir)
    assert.equal(res.status, 1, res.stdout + res.stderr)
    assert.match(res.stderr, /drift:.*manifest\.ts/)
    assert.deepEqual(snapshotTree(dir), before)
  })
})

test('build-skins --check fails with theme id and filename when a declared hero image is missing', () => {
  withTempCopy((dir) => {
    const theme = JSON.parse(
      readFileSync(join(dir, 'src/styles/skins/themes/miku.json'), 'utf8'),
    )
    rmSync(join(dir, 'src/styles/skins/assets', theme.hero))
    const before = snapshotTree(dir)
    const res = runCheck(dir)
    assert.equal(res.status, 1, res.stdout + res.stderr)
    assert.match(res.stderr, new RegExp(theme.id))
    assert.match(res.stderr, new RegExp(theme.hero.replace(/\./g, '\\.')))
    assert.deepEqual(snapshotTree(dir), before)
  })
})

test('build-skins --check allows themes without hero images such as qq-2007 and qq-2008', () => {
  withTempCopy((dir) => {
    const qq2007 = JSON.parse(
      readFileSync(join(dir, 'src/styles/skins/themes/qq-2007.json'), 'utf8'),
    )
    const qq2008 = JSON.parse(
      readFileSync(join(dir, 'src/styles/skins/themes/qq-2008.json'), 'utf8'),
    )
    assert.equal(qq2007.hero, undefined)
    assert.equal(qq2008.hero, undefined)
    const res = runCheck(dir)
    assert.equal(res.status, 0, res.stdout + res.stderr)
    assert.match(res.stdout, /'qq-2007'.*'—'/)
    assert.match(res.stdout, /'qq-2008'.*'—'/)
  })
})
