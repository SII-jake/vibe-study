#!/usr/bin/env bash
# 服务端部署包：把在另一台机器跑 vibe-study 所需的最小产物打成 vibe-study-server.tar.gz
# 用法：bash scripts/package-server.sh [输出目录，默认 dist/deploy]
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 输出必须在 dist/ 之外——dist 本身就是要入包的内容，放里面会递归自拷贝
OUT_DIR="${1:-$REPO_ROOT/deploy-out}"
PKG="vibe-study-server"
WORK="$OUT_DIR/$PKG"

step() { printf '\n== %s ==\n' "$1"; }

step "1/4 构建前端产物"
(cd "$REPO_ROOT" && npm run build)

step "2/4 组装包内容"
rm -rf "$WORK"
mkdir -p "$WORK/server/data"
# 运行时必需
cp "$REPO_ROOT"/package.json "$REPO_ROOT"/package-lock.json "$WORK/"
cp -r "$REPO_ROOT/dist" "$WORK/dist"
# server 源码与示例配置（不含 .env——密钥不进包，到目标机再写）
cp "$REPO_ROOT"/server/*.mjs "$WORK/server/"
cp "$REPO_ROOT"/server/.env.example "$WORK/server/.env.example"

step "3/4 写部署说明"
cat > "$WORK/DEPLOY.md" <<'DOC'
# vibe-study 服务端部署（另一台机器）

## 前置条件
- Node.js >= 18（Node 20/22 均可）
- 一份 DeepSeek API Key（写进 server/.env，不要提交到任何地方）

## 步骤
```bash
tar xzf vibe-study-server.tar.gz && cd vibe-study-server
npm ci --omit=dev
cp server/.env.example server/.env   # 然后编辑：DEEPSEEK_KEY 必填；ACCESS_PASSWORD 建议设强口令（设了即开启登录门卫）
PORT=8787 nohup node server/index.mjs >> server.log 2>&1 &
curl http://127.0.0.1:8787/api/health   # 验证：{"configured":true,...}
```

## 端口与安全
- 默认绑定 127.0.0.1:8787，公网访问请放在 nginx 反代之后（参见本仓库 docs/architecture.md 部署架构）。
- ACCESS_PASSWORD 非空即开启全站登录（含 /api/*），未设则任何能访问端口的人都能用你的 DeepSeek 额度。
- 数据（问答同步事实源）在 server/data/learn-nodes.json，备份这个文件即可。

## 手机壳
dist/app/ 里有一份 APK；修改壳的启动页服务器地址指向本机（或 nginx 域名）后重装即可。
DOC

step "4/4 打包"
tar -czf "$OUT_DIR/$PKG.tar.gz" -C "$OUT_DIR" "$PKG"
sha256sum "$OUT_DIR/$PKG.tar.gz"
ls -la "$OUT_DIR/$PKG.tar.gz"
