#!/usr/bin/env bash
# 把 DeepSeek Harness Skin 装进一份 deepseek-harness 源码检出。
# 用法：scripts/install.sh /path/to/deepseek-harness
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
say() { printf '  %s\n' "$*"; }

[ -n "$TARGET" ] || die "用法：$0 /path/to/deepseek-harness"
[ -d "$TARGET" ] || die "目录不存在：$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

grep -q '"@deepseek-ai/dsh-root"' "$TARGET/package.json" 2>/dev/null \
  || die "这不像是 deepseek-harness 源码检出：$TARGET"

[ -d "$TARGET/packages/client/ui-theme" ] \
  || die "找不到 packages/client/ui-theme，仓库结构对不上"

printf '\n\033[1mDeepSeek Harness Skin 安装\033[0m\n'
say "目标仓库：$TARGET"

# Preflight every input and patch direction before modifying the target.
command -v rsync >/dev/null || die "需要 rsync"
command -v patch >/dev/null || die "需要 patch"
[ -d "$HERE/tree/packages/client/ui-theme" ] || die "缺少皮肤包"
[ -f "$HERE/patches/host-integration.patch" ] || die "缺少宿主补丁"
while IFS= read -r rel; do
  [ -f "$TARGET/$rel" ] || die "缺少宿主文件：$rel"
done < "$HERE/scripts/patched-files.txt"
cd "$TARGET"
APPLY=0
USE_GIT=0
if git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  USE_GIT=1
  if git apply --check "$HERE/patches/host-integration.patch" 2>/dev/null; then
    APPLY=1
  elif ! git apply --check --reverse "$HERE/patches/host-integration.patch" 2>/dev/null; then
    die "补丁预检失败，未修改目标；请检查宿主版本兼容性"
  fi
else
  if patch -f -p1 --forward --dry-run --silent < "$HERE/patches/host-integration.patch" >/dev/null 2>&1; then
    APPLY=1
  elif ! patch -f -p1 --reverse --dry-run --silent < "$HERE/patches/host-integration.patch" >/dev/null 2>&1; then
    die "补丁预检失败，未修改目标；请检查宿主版本兼容性"
  fi
fi

# Independent transaction snapshot also protects upgrades, where the original
# uninstall backup must remain untouched. Keep it if rollback itself fails.
STAGE="$(mktemp -d)"
cp -pR "$TARGET/packages/client/ui-theme" "$STAGE/ui-theme"
while IFS= read -r rel; do
  mkdir -p "$STAGE/$(dirname "$rel")"
  cp -p "$TARGET/$rel" "$STAGE/$rel"
done < "$HERE/scripts/patched-files.txt"
MUTATING=0
COMMITTED=0
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$MUTATING" = 1 ] && [ "$COMMITTED" = 0 ]; then
    set +e
    rollback_ok=1
    rsync -a --delete "$STAGE/ui-theme/" "$TARGET/packages/client/ui-theme/" || rollback_ok=0
    while IFS= read -r rel; do
      cp -p "$STAGE/$rel" "$TARGET/$rel" || rollback_ok=0
    done < "$HERE/scripts/patched-files.txt"
    if [ "$rollback_ok" = 0 ]; then
      printf '回滚失败，保留恢复副本：%s\n' "$STAGE" >&2
      exit 1
    fi
  fi
  rm -rf "$STAGE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# 1. 备份要覆盖的文件，装错了能原样退回。
#    已经装过皮肤就跳过，否则备份的是「装过之后」的样子，卸载会退不干净。
if [ -f "$TARGET/packages/client/ui-theme/src/skin-version.ts" ]; then
  ok "目标已装过皮肤，跳过备份（首次安装的备份仍在 $HOME/.dsh-skin-backups/）"
else
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP="$HOME/.dsh-skin-backups/$STAMP"
  mkdir -p "$BACKUP/packages/client"
  cp -R "$TARGET/packages/client/ui-theme" "$BACKUP/packages/client/ui-theme"
  while IFS= read -r rel; do
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp "$TARGET/$rel" "$BACKUP/$rel"
  done < "$HERE/scripts/patched-files.txt"
  printf '%s\n' "$TARGET" > "$BACKUP/.target"
  ok "已备份到 $BACKUP"
fi

MUTATING=1
rsync -a --delete --exclude 'node_modules' --exclude 'dist' --exclude 'lib' \
  "$HERE/tree/packages/client/ui-theme/" "$TARGET/packages/client/ui-theme/"
if [ "$APPLY" = 1 ]; then
  if [ "$USE_GIT" = 1 ]; then
    git apply "$HERE/patches/host-integration.patch"
  else
    patch -f -p1 --forward --silent --no-backup-if-mismatch -r /dev/null < "$HERE/patches/host-integration.patch"
  fi
fi
COMMITTED=1
ok "皮肤包与宿主补丁安装完成"

printf '\n\033[1m接下来手动跑这三条\033[0m\n'
say "cd $TARGET"
say "pnpm install"
say "pnpm run build"
say "pnpm dsh web"
printf '\n浏览器打开 http://127.0.0.1:3080 ，左下角「设置」→「皮肤」就能换。\n'
printf '想退回原样：scripts/uninstall.sh %s\n\n' "$TARGET"
