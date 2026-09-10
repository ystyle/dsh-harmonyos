#!/usr/bin/env bash
# 把已验证的 dsh-harmonyos 版本原子切换到生产位置。
#
# 原理: ~/.harmonybrew/bin/dsh-ohos 是相对软链 ../lib/node_modules/dsh-harmonyos/bin/dsh-ohos.js,
# 所以只要「同名目录回到原位」软链就依然有效。切换 = 同一父目录内的两次 rename(原子, 不跨盘):
#   1) dsh-harmonyos        -> dsh-harmonyos.bak-<时间戳>
#   2) dsh-harmonyos-staging -> dsh-harmonyos
# 两次 rename 之间的毫秒级窗口里软链会短暂悬空(此刻起新进程会 ENOENT), 已在跑的进程不受影响。
#
# 用法:
#   bash scripts/switch-to-staging.sh            # 干跑, 只打印将要做什么
#   bash scripts/switch-to-staging.sh --apply    # 真正切换
#   bash scripts/switch-to-staging.sh --rollback # 回滚到最新一个 .bak
set -euo pipefail

LIB="${DSH_OHOS_LIB:-$HOME/.harmonybrew/lib/node_modules}"
PROD="$LIB/dsh-harmonyos"
STAGING="${DSH_OHOS_STAGING:-$LIB/dsh-harmonyos-staging}"
MODE="${1:-dry-run}"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

read_version() { node -e "try{process.stdout.write(require('$1/package.json').version)}catch{process.stdout.write('?')}"; }
read_dsh_version() { node -e "try{process.stdout.write(require('$1/node_modules/@deepseek-ai/dsh/package.json').version)}catch{process.stdout.write('?')}"; }
read_marker() { cat "$1/node_modules/.dsh-harmonyos-ready" 2>/dev/null || echo "(无 marker)"; }

if [ "$MODE" = "--rollback" ]; then
  BAK="$(ls -1d "$LIB"/dsh-harmonyos.bak-* 2>/dev/null | sort | tail -1 || true)"
  [ -n "$BAK" ] || die "没有可回滚的 dsh-harmonyos.bak-*"
  say "回滚: $(basename "$BAK") → dsh-harmonyos"
  if [ "${2:-}" != "--apply" ]; then say "(干跑; 加 --apply 执行)"; exit 0; fi
  CUR="$LIB/dsh-harmonyos.failed-$(date +%Y%m%d-%H%M%S)"
  [ -e "$PROD" ] && mv "$PROD" "$CUR"
  mv "$BAK" "$PROD"
  say "✓ 已回滚到 dsh-harmonyos@$(read_version "$PROD") (dsh $(read_dsh_version "$PROD")); 出问题的版本留在 $(basename "$CUR")"
  exit 0
fi

[ -d "$PROD" ] || die "生产目录不存在: $PROD"
[ -d "$STAGING" ] || die "staging 目录不存在: $STAGING (先按 README「升级官方 dsh 的安全流程」建好并验证)"

say "生产 : dsh-harmonyos@$(read_version "$PROD")  (官方 dsh $(read_dsh_version "$PROD"))  marker=$(read_marker "$PROD")"
say "staging: $(basename "$STAGING")@$(read_version "$STAGING")  (官方 dsh $(read_dsh_version "$STAGING"))  marker=$(read_marker "$STAGING")"

# staging 必须已经打过补丁: 检查几个关键标记
MISSING=0
for rel in \
  "node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js" \
  "node_modules/@deepseek-ai/dsh-settings/lib/index.js" \
  "node_modules/@deepseek-ai/dsh-client-connection/lib/index.js" \
  "node_modules/@deepseek-ai/dsh-fs-local/lib/index.js" \
  "node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js" \
  "node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js"; do
  f="$STAGING/$rel"
  if [ ! -f "$f" ]; then say "  ! 缺文件 $rel"; MISSING=1; continue; fi
  grep -qE 'HarmonyOS patch|HarmonyOS /storage mounts|DSH_RG_PATH|DSH_OHOS_FORCE_DANGER' "$f" || { say "  ! 未打补丁 $rel"; MISSING=1; }
done
[ "$MISSING" = 0 ] || die "staging 未完成补丁(在 staging 里跑 npm run patch && npm run prune), 拒绝切换"
say "✓ staging 补丁标记齐全"

BAK="$LIB/dsh-harmonyos.bak-$(date +%Y%m%d-%H%M%S)"
say ""
say "将执行:"
say "  1) mv $PROD   $BAK"
say "  2) mv $STAGING $PROD"
if [ "$MODE" != "--apply" ]; then
  say ""
  say "(干跑结束; 加 --apply 真正执行)"
  exit 0
fi

mv "$PROD" "$BAK"
if ! mv "$STAGING" "$PROD"; then
  say "✗ 第二步失败, 回滚中…"
  mv "$BAK" "$PROD"
  die "切换失败, 已回滚"
fi

say "✓ 已切换到 dsh-harmonyos@$(read_version "$PROD") (官方 dsh $(read_dsh_version "$PROD"))"
say "  备份: $BAK"
say "  回滚: bash $0 --rollback --apply"
say "  提示: 已在跑的 dsh 进程不受影响; 新开终端跑 dsh-ohos 才会用新版本。"
