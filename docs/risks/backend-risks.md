# 后端风险与踩坑

新条目加在本节最上方。

## 引入第二套构建器时，dist 共享目录的"清场默认值"会烧掉旁路资产

- 症状：rspack 首次构建后，`dist/app/` 里 OTA 分发的 APK、`server-version.json`、`.release-seq` 全部消失，`/api/app-version` 只能回退到壳版本。
- 根因：`output.clean: true` 是 rspack/webpack 的默认推荐，但它按"dist 完全归我所有"建模；本仓库 dist 是**多方共享**（前端产物 + publish-apk.sh 的 `dist/app/` + release.sh 的 `server-version.json`）。Vite 端白纸黑字遵守 `emptyOutDir: false` 多年，引入 rspack 时照抄 demo 默认就烧了。
- 做法：任何新构建器接入共有产物目录，第一查"clean/empty 类选项默认值"；守护写成显式 false + 注释点名铁律出处。同类坑的推广口径：**接手工具默认配置时，把"删除性选项"全部显式化**，不留隐含默认。
- 连带发现：rspack 相对 `entry: './src/main.tsx'` 相对 **process.cwd()** 而非配置文件目录解析——从仓库根 `-c web/rspack.config.ts` 时误打了旧前端 `src/main.tsx`（表现为旧 UI 与新 title 同时出现 + `import.meta.env` 运行崩）。构建配置的"相对路径"一律改绝对路径锚在配置文件自身。

## 给已有服务加登录门卫时，最容易漏的是"不带浏览器会话的既有客户端"

- 症状：登录拦截一次过测、公网按钮一开，Android 壳的检查更新/下载 APK 静默 401/302，用户只见到"已是最新"。
- 根因：拦截引入时默认按浏览器模型想问题——会话 Cookie 由浏览器自动携带；而 DownloadManager、健康探活、PWA manifest/sw 这些请求都不带网页 Cookie，逐个漏算。
- 做法：登录门卫设计先列出"所有发起方"清单（浏览器 fetch、Android 壳原生网络栈、爬虫/探活、PWA 启动文件），每条标注带不带会话；豁免路径写成常量（`isPublicPath` / `isPublicApiPath`）并配专测，不许散在 if 里。凡给全站新增访问门槛，先在架构文档回顾"数据归属与写入方"，确定哪些写入/读取方在门卫外。
