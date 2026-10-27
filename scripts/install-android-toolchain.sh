#!/usr/bin/env bash
# 为 vibe-study 安卓打包安装工具链：JDK 17 + Android SDK 命令行工具。
# 用途：装一次，之后 Capacitor/Gradle 构建直接用；脚本幂等，重复运行只补缺失部分。
# 运行方式：bash scripts/install-android-toolchain.sh（全程需要你确认 sudo 密码与许可）

set -euo pipefail

# home 目录空间有限，SDK 放到 workspace（/mnt/local-disk）下
SDK_DIR="$HOME/workspace/Android/Sdk"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-11076708_latest.zip"
# 本地已有的安装包（不再联外网下载）；如不存在才回退到官方地址
LOCAL_ZIP="$HOME/workspace/downloads/${CMDLINE_TOOLS_ZIP}"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/${CMDLINE_TOOLS_ZIP}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../android-toolchain.env"

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }
ok() { printf '\033[1;32mok:\033[0m %s\n' "$1"; }
skip() { printf '\033[0;33mskip:\033[0m %s\n' "$1"; }

step "1/5 安装 JDK 17 与 unzip（需 sudo）"
if java -version 2>&1 | grep -q 'openjdk version "17'; then
  skip "JDK 17 已安装：$(java -version 2>&1 | head -1)"
else
  # 镜像偶发连接失败（部分包报 Connection failed），带重试；已下载的包命中 apt 缓存，重跑很快
  install_ok=0
  for attempt in 1 2 3 4; do
    sudo apt-get update || true
    if sudo apt-get install -y --fix-missing unzip openjdk-17-jre-headless openjdk-17-jre openjdk-17-jdk-headless openjdk-17-jdk; then
      install_ok=1
      break
    fi
    echo "apt 安装失败（第 ${attempt}/4 次），5 秒后重试…"
    sleep 5
  done
  if [ "$install_ok" != "1" ]; then
    echo "JDK 连续 4 次安装失败，请把输出贴给 agent 分析。"
    exit 1
  fi
  ok "$(java -version 2>&1 | head -1)"
fi

step "2/5 解压 Android SDK 命令行工具到 ~/workspace/Android/Sdk"
mkdir -p "$SDK_DIR/cmdline-tools"
if [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  skip "cmdline-tools 已存在"
else
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  if [ -f "$LOCAL_ZIP" ]; then
    ok "使用本地安装包：$LOCAL_ZIP"
    unzip -q -o "$LOCAL_ZIP" -d "$SDK_DIR/cmdline-tools"
  else
    echo "本地安装包不存在（期望 $LOCAL_ZIP），回退从 Google 下载"
    tmp_zip="$(mktemp)"
    curl -fSL "$CMDLINE_TOOLS_URL" -o "$tmp_zip"
    unzip -q -o "$tmp_zip" -d "$SDK_DIR/cmdline-tools"
    rm -f "$tmp_zip"
  fi
  # 官方 zip 展开为 cmdline-tools/cmdline-tools/…，需 latest/ 目录结构给 sdkmanager
  if [ -d "$SDK_DIR/cmdline-tools/cmdline-tools" ]; then
    mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  fi
  ok "解压完成"
fi

step "3/5 接受许可协议（自动回答 yes）"
yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null || true
ok "许可已接受"

step "4/5 安装 platform-tools、android-34 平台与 build-tools 34.0.0（约 300MB，耐心等）"
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" \
  "platforms;android-34" \
  "build-tools;34.0.0"
ok "SDK 组件就绪"

step "5/5 写入环境变量"
cat > "$ENV_FILE" <<EOF
# 安卓构建环境变量；由 install-android-toolchain.sh 生成。
# 使用方式：source ${ENV_FILE}
export ANDROID_HOME="\$HOME/workspace/Android/Sdk"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export PATH="\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH"
EOF
# bashrc 追加（带标记行，重复运行不会重复追加）
MARKER="# vibe-study android toolchain"
if ! grep -q "$MARKER" "$HOME/.bashrc" 2>/dev/null; then
  printf '\n%s\nsource %s\n' "$MARKER" "$ENV_FILE" >> "$HOME/.bashrc"
  ok "已追加到 ~/.bashrc"
else
  skip "~/.bashrc 已有标记，未重复追加"
fi
# 当前 shell 也要能立刻用
# shellcheck disable=SC1090
source "$ENV_FILE"

step "验收"
java -version 2>&1 | head -1
echo "sdkmanager: $(command -v sdkmanager)"
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --version | head -1
echo "adb: $(command -v adb)"
echo "已安装组件："
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --list_installed 2>/dev/null | grep -E "platform|build-tools" | head -5
printf '\n全部完成后告诉 agent 即可开始 Capacitor 打包。\n'
