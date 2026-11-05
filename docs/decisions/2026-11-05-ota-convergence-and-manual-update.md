# OTA 链路收口、全分支并入 develop 与设置页手动更新

## 背景

- 真机反馈自动更新不 work：`/api/app-version` 404，`dist/app/` 无发布 APK——OTA 实现停在未合入的 `feature/app-ota` 分支，从未进入主干，线上跑的是旧进程。
- 仓库同时挂着 5 个内容分支与一个 worktree（OTA、对话同步、口令登录、状态栏修复、手动更新），互不重叠却各自积水，合并口径长期不清。

## 范围与非目标

- 范围：4 个内容分支+1 个 worktree 全部并入 develop；OTA 三件套（服务端版本接口、原生桥、壳内检查）真正落地主干；设置页新增手动检查更新；构建 1.0.2 完整 APK。
- 非目标：不开 PR、不部署重启线上 8787 进程（部署动作归用户另行指令）。

## 考虑过的取舍

1. **OTA 走 cherry-pick 还是 merge app-ota 分支**：app-ota 还背着大量与 OTA 无关的旧实验提交，直接 merge 会把无关历史带进主干。选择把 OTA 两个提交 cherry-pick 进 `fix/manual-update`，冲突按语义合并（保留主干已有壳能力 + OTA），之后删源头分支。
2. **合并途中发现的三个修正直接落在主干，不回旧分支修**：版本接口 CORS 头（壳 WebView 跨源 fetch 的命脉）、vite `emptyOutDir:false`（防 build 清空在发 APK）、APK 产物命名（服务端按文件名解析版本号）。回旧分支修再合入徒增往返，且旧分支随后即删。
3. **手动更新复用启动页状态机而非新写一套**：`checkAppUpdate` 的状态机已测过边界（无桥/404/离线/权限/非法 versionCode），设置页只换两个口径——请求改同源 `location.origin`、无桥时按钮不渲染，新代码面最小；文案每种状态有落地句，不静默。
4. **登录走整页 form POST 导航而非 fetch**：启动页 file:// 源 fetch 跨源 Cookie 在移动 WebView 不可靠（OTA 同型坑）；导航不受 CORS 限制。OTA 版本接口与 APK 下载在口令门卫之外（公开、无密钥无用户数据），否则未登录设备永远收不到更新。
5. **分支清理用祖先验证而非 `git branch -d` 判定**：`--merged` 受上游跟踪配置影响误报，逐一 `merge-base --is-ancestor` 确认 tip 是 develop 祖先后才删；cherry-pick 并入的 app-ota 用 `-D`，并确认其独有内容（CORS 修正版、e2e 脚本）已在 develop。

## 最终方案

- develop = develop 基线 + OTA（含设置页手动更新）+ 对话同步 + 口令登录（IP 直连、裸 HTTP 时 AUTH_SECURE 降级）+ 状态栏修复，四批 merge 保留可追溯历史，分支清理后本地只剩 develop。
- versionName 1.0.2（versionCode 同算法推导为 10002000），签名沿用原 keystore（指纹 c591b1cd… 不变），产物 `vibe-study-1.0.2-release.apk` 落 `dist/app/`。

## 遗留问题

- 线上 8787 仍跑旧进程：develop 推送后需部署并重启服务端，`/api/app-version` 才会从 404 变 200，OTA 自动检查才真正循环起来。
- develop 与 main 的关系（main 是否吸收 develop）待定夺。
- 合并途中曾用正则解冲突误删 `boot.js` 口令函数（5 条测试红，已修复）。教训：解冲突后对账「测试引用符号 ≡ 产物存在符号」，不只看冲突标记清零。
