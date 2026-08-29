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
TARGET="$(cd "$TARGET" && pwd -P)"

ROOT="$HOME/.dsh-skin-backups"
[ -d "$ROOT" ] || die "没有找到任何备份（$ROOT 不存在）"

if [ -z "$STAMP" ]; then
  # 只取最近一次「针对这个目标」的备份，绝不跨检出兜底。
  for candidate in $(ls -1 "$ROOT" | sort -r); do
    [ -f "$ROOT/$candidate/.target" ] || continue
    recorded_target="$(cat "$ROOT/$candidate/.target")"
    [ -d "$recorded_target" ] || continue
    recorded_target="$(cd "$recorded_target" && pwd -P)"
    [ "$recorded_target" = "$TARGET" ] || continue
    STAMP="$candidate"; break
  done
  [ -n "$STAMP" ] && say "匹配到该目标的备份：$STAMP"
fi
[ -n "$STAMP" ] || die "没有找到归属于该目标仓库的备份：$TARGET"
BACKUP="$ROOT/$STAMP"
[ -d "$BACKUP" ] || die "备份不存在：$BACKUP"
[ -f "$BACKUP/.target" ] || die "备份缺少目标归属记录：$BACKUP/.target"
BACKUP_TARGET="$(cat "$BACKUP/.target")"
[ -d "$BACKUP_TARGET" ] || die "备份记录的目标目录不存在：$BACKUP_TARGET"
BACKUP_TARGET="$(cd "$BACKUP_TARGET" && pwd -P)"
[ "$BACKUP_TARGET" = "$TARGET" ] \
  || die "备份归属于其他目标：$BACKUP_TARGET（当前目标：$TARGET）"

# 备份本身带皮肤就说明它记录的是「装过之后」的状态，还原它等于没卸载
[ -f "$BACKUP/packages/client/ui-theme/src/skin-version.ts" ] \
  && die "这份备份里已经含皮肤（$BACKUP），还原它退不回原生。请指定更早的时间戳：ls $ROOT"
[ -d "$BACKUP/packages/client/ui-theme" ] \
  || die "备份缺少 ui-theme 包：$BACKUP/packages/client/ui-theme"

printf '\n\033[1mDeepSeek Harness Skin 卸载\033[0m\n'
say "目标仓库：$TARGET"
say "还原自：$BACKUP"

THEME_TARGET="$TARGET/packages/client/ui-theme"
[ -d "$THEME_TARGET" ] || die "目标缺少 ui-theme 包：$THEME_TARGET"
THEME_ROLLBACK="${THEME_TARGET}.uninstall-rollback.$$"
[ ! -e "$THEME_ROLLBACK" ] || die "回滚目录已存在：$THEME_ROLLBACK"

mv "$THEME_TARGET" "$THEME_ROLLBACK"
if ! cp -R "$BACKUP/packages/client/ui-theme" "$THEME_TARGET"; then
  rm -rf "$THEME_TARGET"
  mv "$THEME_ROLLBACK" "$THEME_TARGET"
  die "还原 ui-theme 失败，已恢复卸载前目录"
fi
rm -rf "$THEME_ROLLBACK"
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
