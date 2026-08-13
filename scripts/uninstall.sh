#!/usr/bin/env bash
# 把 deepseek-harness 退回安装皮肤之前的样子。
# 用法：scripts/uninstall.sh /path/to/deepseek-harness [备份时间戳]
set -euo pipefail

TARGET="${1:-}"
STAMP="${2:-}"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
say() { printf '  %s\n' "$*"; }

[ -n "$TARGET" ] || die "用法：$0 /path/to/deepseek-harness [备份时间戳]"
[ -d "$TARGET" ] || die "目录不存在：$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

ROOT="$HOME/.dsh-skin-backups"
[ -d "$ROOT" ] || die "没有找到任何备份（$ROOT 不存在）"

if [ -z "$STAMP" ]; then
  # 取最近一次「针对这个目标」的备份；没有匹配记录时退回到最新一份
  for candidate in $(ls -1 "$ROOT" | sort -r); do
    if [ -f "$ROOT/$candidate/.target" ] && [ "$(cat "$ROOT/$candidate/.target")" = "$TARGET" ]; then
      STAMP="$candidate"; break
    fi
  done
  [ -n "$STAMP" ] && say "匹配到该目标的备份：$STAMP"
fi
if [ -z "$STAMP" ]; then
  STAMP="$(ls -1 "$ROOT" | sort | tail -1)"
  [ -n "$STAMP" ] || die "$ROOT 里没有备份"
fi
BACKUP="$ROOT/$STAMP"
[ -d "$BACKUP" ] || die "备份不存在：$BACKUP"

# 备份本身带皮肤就说明它记录的是「装过之后」的状态，还原它等于没卸载
[ -f "$BACKUP/packages/client/ui-theme/src/skin-version.ts" ] \
  && die "这份备份里已经含皮肤（$BACKUP），还原它退不回原生。请指定更早的时间戳：ls $ROOT"

printf '\n\033[1mDeepSeek Harness Skin 卸载\033[0m\n'
say "目标仓库：$TARGET"
say "还原自：$BACKUP"

rm -rf "$TARGET/packages/client/ui-theme"
cp -R "$BACKUP/packages/client/ui-theme" "$TARGET/packages/client/ui-theme"
ok "已还原 ui-theme 包"

while IFS= read -r rel; do
  [ -f "$BACKUP/$rel" ] || continue
  cp "$BACKUP/$rel" "$TARGET/$rel"
done < "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/patched-files.txt"
ok "已还原宿主集成补丁涉及的 8 个文件"

printf '\n\033[1m接下来手动跑这两条\033[0m\n'
say "cd $TARGET"
say "pnpm install && pnpm run build"
printf '\n本机上传过的自定义背景图仍留在 ~/.dsh/skins/，不用可以自行删除。\n\n'
