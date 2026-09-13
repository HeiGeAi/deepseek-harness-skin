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

# 2. 覆盖 ui-theme 包
rsync -a --delete --exclude 'node_modules' --exclude 'dist' --exclude 'lib' \
  "$HERE/tree/packages/client/ui-theme/" "$TARGET/packages/client/ui-theme/"
ok "已写入 ui-theme 皮肤包（21 套预设 + 自定义皮肤 + 更新检查）"

# 3. 打宿主集成补丁（背景层、玻璃拟态、消息气泡透明度）
cd "$TARGET"
if git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  if git apply --check "$HERE/patches/host-integration.patch" 2>/dev/null; then
    git apply "$HERE/patches/host-integration.patch"
    ok "已打宿主集成补丁"
  elif git apply --check --reverse "$HERE/patches/host-integration.patch" 2>/dev/null; then
    ok "宿主集成补丁已在，跳过"
  else
    die "补丁打不上。你的 deepseek-harness 版本可能和本皮肤包不匹配（本包基于 0.1.0-rc.5），请手工比对 patches/host-integration.patch"
  fi
else
  # patch 逐文件落盘，先 --dry-run 全量预检，打不上就一个文件都不动（-f 非交互，问题一律按否处理）
  if patch -f -p1 --forward --dry-run --silent < "$HERE/patches/host-integration.patch" >/dev/null 2>&1; then
    patch -f -p1 --forward --silent < "$HERE/patches/host-integration.patch" \
      || die "补丁打不上，请手工比对 patches/host-integration.patch"
    ok "已打宿主集成补丁"
  elif patch -f -p1 --reverse --dry-run --silent < "$HERE/patches/host-integration.patch" >/dev/null 2>&1; then
    ok "宿主集成补丁已在，跳过"
  else
    die "补丁打不上（预检失败，未落盘任何改动）。你的 deepseek-harness 版本可能和本皮肤包不匹配（本包基于 0.1.0-rc.5），请手工比对 patches/host-integration.patch"
  fi
fi

printf '\n\033[1m接下来手动跑这三条\033[0m\n'
say "cd $TARGET"
say "pnpm install"
say "pnpm run build"
say "pnpm dsh web"
printf '\n浏览器打开 http://127.0.0.1:3080 ，左下角「设置」→「皮肤」就能换。\n'
printf '想退回原样：scripts/uninstall.sh %s\n\n' "$TARGET"
