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
  assert_unchanged "$target_b" "installed-b"
}

test_automatic_lookup_never_uses_another_checkout_backup
printf 'ok 1 - automatic lookup is bound to the requested checkout\n'
test_explicit_stamp_must_match_requested_checkout
printf 'ok 2 - explicit backup stamp is bound to the requested checkout\n'
