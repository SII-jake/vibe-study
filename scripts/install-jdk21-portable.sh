#!/usr/bin/env bash
# 安装独立 JDK 21（Adoptium 清华镜像）到 ~/workspace/jdk-21，供 Capacitor 8 构建用。
# 不需要 sudo、不依赖内网 apt 镜像（nexus 偶发连接失败绕不过去）。
# 用途：脚本幂等，重复运行只补下载/解压缺失部分。
set -euo pipefail

TARGET="$HOME/workspace/jdk-21"
JDK_TGZ="OpenJDK21U-jdk_x64_linux_hotspot_21.0.13_9.tar.gz"
DOWNLOADS="$HOME/workspace/downloads"
URL="https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/linux/${JDK_TGZ}"

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }

step "1/3 下载 JDK 21 压缩包（约 200MB，清华 Adoptium 镜像，无需 sudo）"
mkdir -p "$DOWNLOADS"
if [ -f "$DOWNLOADS/$JDK_TGZ" ]; then
  echo "skip: 已存在 $DOWNLOADS/$JDK_TGZ"
else
  curl -fSL --retry 3 --retry-delay 5 "$URL" -o "$DOWNLOADS/$JDK_TGZ"
fi

step "2/3 解压到 ~/workspace/jdk-21"
if [ -x "$TARGET/bin/java" ]; then
  echo "skip: $TARGET/bin/java 已存在"
else
  rm -rf "$TARGET.tmp"
  mkdir -p "$TARGET.tmp"
  tar -xzf "$DOWNLOADS/$JDK_TGZ" -C "$TARGET.tmp" --strip-components=1
  rm -rf "$TARGET"
  mv "$TARGET.tmp" "$TARGET"
fi

step "3/3 验收"
"$TARGET/bin/java" -version
echo ""
echo "下一步：构建 APK 时带上 JDK 21 的环境，例如"
echo "  JAVA_HOME=$HOME/workspace/jdk-21 \\"
echo "    $PWD/android/gradlew -p $PWD/android assembleDebug --init-script android/aliyun-init.gradle"
