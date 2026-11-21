#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNINSTALL="$ROOT_DIR/scripts/uninstall.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-uninstall-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

make_target() {
  local target="$1"
  local marker="$2"
  mkdir -p "$target/packages/client/ui-theme/src"
  printf '{"name":"@deepseek-ai/dsh-root"}\n' > "$target/package.json"
  printf '%s\n' "$marker" > "$target/packages/client/ui-theme/current.txt"
}

make_backup() {
  local home="$1"
  local stamp="$2"
  local target="$3"
  local marker="$4"
  local backup="$home/.dsh-skin-backups/$stamp"
  mkdir -p "$backup/packages/client/ui-theme/src"
  printf '%s\n' "$marker" > "$backup/packages/client/ui-theme/current.txt"
  printf '%s\n' "$target" > "$backup/.target"
}

assert_unchanged() {
  local target="$1"
  local expected="$2"
  local actual
  actual="$(cat "$target/packages/client/ui-theme/current.txt")"
  [ "$actual" = "$expected" ] || {
    printf 'expected target marker %s, got %s\n' "$expected" "$actual" >&2
    return 1
  }
}

assert_log_contains() {
  local log="$1"
  local needle="$2"
  grep -Fq "$needle" "$log" || {
    printf 'expected log %s to contain %s, got:\n' "$log" "$needle" >&2
    cat "$log" >&2
    return 1
  }
}

test_automatic_lookup_never_uses_another_checkout_backup() {
  local case_dir="$TMP_ROOT/automatic"
  local home="$case_dir/home"
  local target_a="$case_dir/checkout-a"
  local target_b="$case_dir/checkout-b"
  mkdir -p "$home"
  make_target "$target_a" "installed-a"
  make_target "$target_b" "installed-b"
  make_backup "$home" "20260830-100000" "$target_a" "native-a"

  if HOME="$home" bash "$UNINSTALL" "$target_b" >"$case_dir/output.log" 2>&1; then
    printf 'uninstall unexpectedly accepted checkout A backup for checkout B\n' >&2
    return 1
  fi
  assert_log_contains "$case_dir/output.log" "没有找到归属于该目标仓库的备份"
  assert_unchanged "$target_b" "installed-b"
}

test_explicit_stamp_must_match_requested_checkout() {
  local case_dir="$TMP_ROOT/explicit"
  local home="$case_dir/home"
  local target_a="$case_dir/checkout-a"
  local target_b="$case_dir/checkout-b"
  local stamp="20260830-110000"
  mkdir -p "$home"
  make_target "$target_a" "installed-a"
  make_target "$target_b" "installed-b"
  make_backup "$home" "$stamp" "$target_a" "native-a"

  if HOME="$home" bash "$UNINSTALL" "$target_b" "$stamp" >"$case_dir/output.log" 2>&1; then
    printf 'uninstall unexpectedly accepted an explicitly mismatched backup\n' >&2
    return 1
  fi
  assert_log_contains "$case_dir/output.log" "备份归属于其他目标"
  assert_unchanged "$target_b" "installed-b"
}

test_symlink_recorded_target_restores_matching_checkout() {
  local case_dir="$TMP_ROOT/symlink"
  local home="$case_dir/home"
  local real_target="$case_dir/real-checkout"
  local link_target="$case_dir/link-checkout"
  local stamp="20260830-120000"
  mkdir -p "$home"
  make_target "$real_target" "installed-real"
  ln -s "$real_target" "$link_target"
  make_backup "$home" "$stamp" "$link_target" "native-real"

  HOME="$home" bash "$UNINSTALL" "$link_target" "$stamp" >"$case_dir/output.log" 2>&1
  assert_unchanged "$real_target" "native-real"
}

test_traversal_stamp_is_rejected() {
  local case_dir="$TMP_ROOT/traversal"
  local home="$case_dir/home"
  local target="$case_dir/checkout"
  mkdir -p "$home/.dsh-skin-backups"
  make_target "$target" "installed-safe"
  make_backup "$home" "20260830-130000" "$target" "native-safe"

  if HOME="$home" bash "$UNINSTALL" "$target" "../.dsh-skin-backups/20260830-130000" >"$case_dir/output.log" 2>&1; then
    printf 'uninstall unexpectedly accepted traversal stamp\n' >&2
    return 1
  fi
  assert_log_contains "$case_dir/output.log" "非法备份时间戳"
  assert_unchanged "$target" "installed-safe"
}

test_skinned_backup_is_rejected_cleanly() {
  local case_dir="$TMP_ROOT/skinned"
  local home="$case_dir/home"
  local target="$case_dir/checkout"
  local stamp="20260830-140000"
  mkdir -p "$home"
  make_target "$target" "installed-current"
  make_backup "$home" "$stamp" "$target" "skinned-backup"
  printf 'export const SKIN_VERSION = "1.0.1"\n' > "$home/.dsh-skin-backups/$stamp/packages/client/ui-theme/src/skin-version.ts"

  if HOME="$home" bash "$UNINSTALL" "$target" "$stamp" >"$case_dir/output.log" 2>&1; then
    printf 'uninstall unexpectedly accepted backup containing skin-version.ts\n' >&2
    return 1
  fi
  assert_log_contains "$case_dir/output.log" "这份备份里已经含皮肤"
  assert_unchanged "$target" "installed-current"
}

test_automatic_lookup_never_uses_another_checkout_backup
printf 'ok 1 - automatic lookup is bound to the requested checkout\n'
test_explicit_stamp_must_match_requested_checkout
printf 'ok 2 - explicit backup stamp is bound to the requested checkout\n'
test_symlink_recorded_target_restores_matching_checkout
printf 'ok 3 - symlinked .target path resolves canonically and restores\n'
test_traversal_stamp_is_rejected
printf 'ok 4 - path traversal stamp is rejected\n'
test_skinned_backup_is_rejected_cleanly
printf 'ok 5 - backup already containing skin-version.ts is rejected cleanly\n'
