#!/usr/bin/env bash
# 发布 APP 更新包：构建 release APK → 校验签名 → 拷入 dist/app/（服务器 /api/app-version 与 /app/ 随即生效）。
# 用法：bash scripts/publish-apk.sh
# 前提：android-toolchain.env 已生成（scripts/install-android-toolchain.sh），
#       android/keystore.properties + android/app/keystore/*.jks 在位（本地持有，不进 git）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$REPO_ROOT/android-toolchain.env"

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }

step "0/3 环境前置检查"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  echo "缺少 $ENV_FILE，请先运行 scripts/install-android-toolchain.sh"
  exit 1
fi
if [ ! -f "$REPO_ROOT/android/keystore.properties" ]; then
  echo "缺少 android/keystore.properties（release 签名配置，本地持有）"
  exit 1
fi

step "1/3 同步壳内资产 + 构建 release APK（Gradle 自行解析 keystore.properties）"
# android-shell/ 并不会自己进 APK——npx cap sync 才把它拷到
# app/src/main/assets/public/（该目录 gitignored）。少了这步，启动页/boot.js
# 改动打了包也不会生效（手机上曾因此拿不到 datalist 下拉，实测踩坑）。
(cd "$REPO_ROOT" && npx cap sync android)
# Capacitor 8 要求 JDK 21 编译（capacitor.build.gradle JavaVersion.VERSION_21）；
# 工具链 install-android-toolchain.sh 给的是 17，发布构建固定指向便携 JDK 21
export JAVA_HOME="${JAVA_HOME_OVERRIDE:-$HOME/workspace/jdk-21}"
[ -x "$JAVA_HOME/bin/java" ] || { echo "缺少 JDK 21：bash scripts/install-jdk21-portable.sh"; exit 1; }
(cd "$REPO_ROOT/android" && ./gradlew :app:assembleRelease --init-script aliyun-init.gradle --quiet)
APK="$(find "$REPO_ROOT/android/app/build/outputs/apk/release" -maxdepth 1 -name '*.apk' | sort | head -1)"
if [ -z "$APK" ]; then
  echo "构建成功但未找到 APK 产物"
  exit 1
fi
echo "产物：$APK"

step "1.5/3 校验 APK 真实 versionCode 与 versionName 派生一致"
# 1.0.8→1.0.13 事故：build.gradle 的 semParts 硬编码 "1.0.7"，逐版 bump 只动了
# versionName，每个包真实 versionCode 都是 10007000——服务器按文件名发 100xx000，
# 桥读到手机 10007000 永远"小于"，用户装多少遍新版都再被提示更新。
# 这里用 aapt2 dump 直接读产物清单对账，不一致立即拦下不发。
AAPT2_BIN="$(ls "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$AAPT2_BIN" ]; then
  actual_code="$("$AAPT2_BIN" dump badging "$APK" 2>/dev/null | rg "versionCode='" | head -1 | sed -E "s/.*versionCode='([0-9]+)'.*/\1/")"
  vn="$(basename "$APK" | sed -E 's/.+-([0-9]+\.[0-9]+\.[0-9]+)-.+\.apk/\1/')"
  IFS='.' read -r MA MI PA <<<"$vn"
  expect_code=$(( MA * 10000000 + MI * 100000 + PA * 1000 ))
  if [ "$actual_code" != "$expect_code" ]; then
    echo "versionCode 不一致！APK 内部 $actual_code ≠ versionName $vn 派生 $expect_code"
    echo "通常原因：build.gradle 的 versionCode 推导没从 versionName 派生——禁止带病发版。"
    exit 1
  fi
  echo "versionCode 对账通过：$actual_code"
fi

step "2/3 校验包名与签名一致（签名变了旧机无法覆盖升级）"
# 与 dist/app/ 里正在分发的旧包比对证书指纹；首次发布（无旧包）跳过
CURRENT_CERT=""
for tool in apksigner; do
  CANDIDATE="$(ls "$ANDROID_HOME"/build-tools/*/$tool 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$CANDIDATE" ] && CURRENT_CERT="$CANDIDATE" && break
done
if [ -n "$CURRENT_CERT" ]; then
  new_sha=$("$CURRENT_CERT" verify --print-certs "$APK" | rg 'certificate SHA-256' | head -1 | awk '{print $NF}')
  old_apk="$(find "$REPO_ROOT/dist/app" -maxdepth 1 -name '*.apk' 2>/dev/null | sort | head -1 || true)"
  if [ -n "$old_apk" ]; then
    old_sha=$("$CURRENT_CERT" verify --print-certs "$old_apk" | rg 'certificate SHA-256' | head -1 | awk '{print $NF}')
    if [ "$new_sha" != "$old_sha" ]; then
      echo "签名不一致！新包 $new_sha ≠ 在发 $old_sha，旧机将无法覆盖安装。"
      echo "请确认 keystore 未更换；确要换签名需全员先卸载旧版。"
      exit 1
    fi
    echo "签名指纹一致：${new_sha:0:16}…"
  else
    echo "首次发布，登记证书指纹：${new_sha:0:16}…"
  fi
fi

step "3/3 落到 dist/app/（同目录只保留最新一份，服务端扫描即取它）"
mkdir -p "$REPO_ROOT/dist/app"
find "$REPO_ROOT/dist/app" -maxdepth 1 -name '*.apk' -delete
cp "$APK" "$REPO_ROOT/dist/app/$(basename "$APK")"
SHA=$(sha256sum "$REPO_ROOT/dist/app/$(basename "$APK")" | awk '{print $1}')
echo "已发布：dist/app/$(basename "$APK")"
echo "SHA-256：$SHA"
echo "shell 无需另建 version.json —— /api/app-version 会实时读取该文件并给出上述哈希。"
