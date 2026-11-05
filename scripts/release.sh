#!/usr/bin/env bash
# 一键发布：前端重新构建 → 打包 release APK → 精确重启后端服务 → 健康检查。
# 用法：bash scripts/release.sh
# 生产形态（server/index.mjs + docs/architecture.md §六）：唯一的 node 后端既
# 服务 /api/*，也把 dist/ 静态产物发给浏览器；「前端」没有独立进程，重新 build
# 即随后端刷新。后端监听 127.0.0.1:8787（nginx 反代到外部域名），日志固定
# 追加到 /tmp/study-api.log。
#
# 安全红线：重启环节只允许杀「监听 8787 且 cwd 是本仓库、命令行是 node
# server/index.mjs」的那一个进程；三条件任一不满足就拒绝动手并报错退出，
# 绝不按端口粗暴 pkill，避免误伤同机其它服务。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LISTEN_PORT="${PORT:-8787}"
LISTEN_HOST="${HOST:-127.0.0.1}"
SERVER_LOG="${SERVER_LOG:-/tmp/study-api.log}"

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }
die() { printf '\033[1;31m发布中止：%s\033[0m\n' "$1" >&2; exit 1; }

step "0/6 前置检查"
[ -f "$REPO_ROOT/package.json" ] || die "脚本位置异常：$REPO_ROOT 下没有 package.json"
[ -d "$REPO_ROOT/node_modules" ] || die "依赖未安装，先跑 npm install"
# 版本只读不 bump：bump 属发版决策，由人改 build.gradle 后再跑本脚本
VERSION_NAME="$(rg -o '^\s*versionName "([^"]+)"' --replace '$1' "$REPO_ROOT/android/app/build.gradle" | head -1)"
[ -n "$VERSION_NAME" ] || die "无法从 android/app/build.gradle 读到 versionName"
echo "目标版本：$VERSION_NAME"

step "1/6 质量门（vitest 单测全绿才允许动线上服务）"
(cd "$REPO_ROOT" && npm test)

step "2/6 前端构建（tsc --noEmit + vite build → dist/）"
(cd "$REPO_ROOT" && npm run build)
[ -f "$REPO_ROOT/dist/index.html" ] || die "构建成功但 dist/index.html 缺失"

step "3/6 打包 release APK（复用 publish-apk.sh：构建→验签→落 dist/app/）"
bash "$SCRIPT_DIR/publish-apk.sh"

step "4/6 校验产物就位"
APK_FILE="$(find "$REPO_ROOT/dist/app" -maxdepth 1 -name "vibe-study-${VERSION_NAME}-release.apk" | head -1)"
[ -n "$APK_FILE" ] || die "dist/app/ 下未找到 vibe-study-${VERSION_NAME}-release.apk（versionName 与产物不符？）"
echo "APK 就位：$APK_FILE"

# 服务端版本（双版本第二口径）：壳版本不变的服务端前进也要可见。
# seq 持久化在 dist/app/.release-seq（publish-apk.sh 只清 *.apk，不动隐藏文件），
# 每次发布自增；版本串 = <壳 versionName>.<seq>，老部署无 seq 文件从 0 起。
SEQ_FILE="$REPO_ROOT/dist/app/.release-seq"
SEQ=$(( $(cat "$SEQ_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$SEQ" > "$SEQ_FILE"
SERVER_VERSION="${VERSION_NAME}.${SEQ}"
printf '{"version":"%s"}' "$SERVER_VERSION" > "$REPO_ROOT/dist/server-version.json"
echo "服务端版本：$SERVER_VERSION（seq=$SEQ，已写 dist/server-version.json）"

step "5/6 重启后端（精确匹配 + 优雅停机 + nohup 接管）"
find_server_pid() {
  # 监听 8787 的进程可能有多个（理论上），逐个核对身份
  local pids pid cwd cmdline
  pids="$(ss -tlnp "sport = :$LISTEN_PORT" 2>/dev/null | rg -o 'pid=[0-9]+' | cut -d= -f2 | sort -u)"
  for pid in $pids; do
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [ "$cwd" = "$REPO_ROOT" ] && [[ "$cmdline" =~ ^node\ server/index\.mjs ]]; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

OLD_PID="$(find_server_pid || true)"
if [ -z "$OLD_PID" ]; then
  # 不敢杀的坚决不杀：宁可中断发布让人来看，也不猜
  stray="$(ss -tlnp "sport = :$LISTEN_PORT" 2>/dev/null | rg -o 'pid=[0-9]+' | sort -u || true)"
  if [ -n "$stray" ]; then
    die "$LISTEN_PORT 被进程占用但身份不匹配（非本仓库 node server/index.mjs），拒绝误杀。请人工检查：ss -tlnp sport = :$LISTEN_PORT"
  fi
  echo "当前无后端进程在跑，直接冷启动。"
else
  echo "旧后端 PID=$OLD_PID，发送 TERM 等待退出…"
  kill "$OLD_PID"
  for _ in $(seq 1 20); do
    kill -0 "$OLD_PID" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "TERM 后 10s 未退出，升级 KILL。"
    kill -9 "$OLD_PID" || true
    sleep 1
  fi
fi

# setsid + nohup：新后端脱离本脚本的进程组与会话，脚本/agent 退出后服务仍存活；
# 日志沿用 /tmp/study-api.log 追加，与原有人工起服务的习惯一致。
# 两条实测教训（均已登记 docs/risks/frontend-risks.md）：
# 1) 不能先 spawn 再用 $! 抓 PID——bash 嵌套包装会让 $! 指到包装 shell 而不是 node。
# 2) 后台 job 必须 disown 且 stdin 接 /dev/null——否则脚本挂在 do_wait 等 node、
#    node 继承脚本 stdout 的 pipe（如 `bash release.sh | tail`）让下游永远等不到 EOF。
(cd "$REPO_ROOT" && setsid nohup node server/index.mjs >> "$SERVER_LOG" 2>&1 < /dev/null & disown)
sleep 1
NEW_PID="$(find_server_pid || true)"
[ -n "$NEW_PID" ] || die "新后端 spawn 后按身份匹配找不到进程（未起来？日志见 $SERVER_LOG）"
echo "新后端 PID=$NEW_PID（日志 $SERVER_LOG）"

step "6/6 健康检查（最多等 15s）"
healthy=""
for _ in $(seq 1 30); do
  body="$(curl -sf --max-time 2 "http://${LISTEN_HOST}:${LISTEN_PORT}/api/app-version" 2>/dev/null || true)"
  if [ -n "$body" ]; then
    # 服务端的唯一版本口径：扫 dist/app/ 的 APK 文件名；与工程源 build.gradle 对拍
    served="$(printf '%s' "$body" | rg -o '"versionName":"[^"]+"' | head -1 | cut -d'"' -f4)"
      # 服务端版本（发布脚本本次自增）也必须在响应里，否则新前端拿不到第二口径
      served_sv="$(printf '%s' "$body" | rg -o '"serverVersion":"[^"]+"' | head -1 | cut -d'"' -f4)"
      if [ "$served" = "$VERSION_NAME" ] && [ "$served_sv" = "$SERVER_VERSION" ]; then
      healthy="1"
        echo "后端健康：/api/app-version 返回 versionName=$served、serverVersion=$served_sv"
      break
    fi
  fi
  sleep 0.5
done
if [ -z "$healthy" ]; then
  echo "--- $SERVER_LOG 末尾 ---"
  tail -n 30 "$SERVER_LOG" || true
  die "健康检查失败：新后端未在 15s 内以版本 $VERSION_NAME 应答，请人工排查（服务可能中断中）。"
fi
curl -sf -o /dev/null "http://${LISTEN_HOST}:${LISTEN_PORT}/" || die "静态首页不可达，请人工排查"
echo "静态首页可达。"

printf '\n\033[1;32m发布完成：应用版本 %s｜服务端版本 %s（后端 PID=%s）\033[0m\n' "$VERSION_NAME" "$SERVER_VERSION" "$NEW_PID"
