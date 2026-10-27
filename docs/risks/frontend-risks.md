# 前端风险与踩坑

新条目加在本节最上方。

## 锚点高亮在目标元素自身查找后代，导致永远命中不了

- 症状：返回父节点后 `mark` 元素数为 0，锚点高亮完全不出现；单元测试却是绿的。
- 根因：`highlightInFragment` 接收容器后调用 `querySelector('[data-fragment-index="N"]')` 向下查找片段元素，而调用方传入的正是片段元素本身，因此查询结果恒为 null。测试里多套了一层容器，掩盖了这个差异。
- 做法：函数直接接收片段元素，不再自行查找；单元测试里补一条"片段元素自身带 `data-fragment-index`"的用例。凡是"在传入元素内部查找它自己"的写法，测试必须覆盖调用方真实传入的那一层。

## Range.surroundContents 跨越行内元素时抛 InvalidStateError

- 症状：`The Range has partially contains a non-Text node`。
- 根因：`surroundContents` 要求区间完整包含某个节点，选区跨越 `<strong>` 等行内元素时区间只包含其中一部分。
- 做法：改用 `extractContents()` 取出区间内容、构造 `mark` 后 `insertNode`，可跨行内元素合并成一个高亮。

## DOMPurify 在 node 测试环境下拿到的是工厂函数

- 症状：`default.sanitize is not a function`。
- 根因：DOMPurify 需要一个 DOM `window`；vitest 默认 node 环境没有，导入得到的是未初始化的工厂函数。
- 做法：涉及渲染与选区解析的测试文件首行声明 `// @vitest-environment jsdom`。

## 浏览器选区文本与 Markdown 纯文本的空白不一致

- 症状：跨列表项选中文字后，锚点定位与高亮都失败。
- 根因：浏览器选区取到的是渲染后的文本，块与块之间是一个空格；段落纯文本折行后也可能多出空格。
- 做法：定位统一走 `src/domain/text-match.ts` 的 `locateRange`，先精确匹配、再退到"去空白后匹配并映射回原文区间"；锚点解析与 DOM 高亮共用同一实现，不各写一套。

## 密钥放进浏览器等于半公开

- 症状：早期版本把 `AI_API_KEY` 存在 `localStorage` 并由前端直连模型接口，打开 DevTools 即可读到完整密钥。
- 根因：纯前端没有可信执行边界，任何落到浏览器的东西都属于使用者可见范围；靠"只有自己用"来当作安全前提，一旦设备共用或浏览器被同步就失效。
- 做法：密钥只存在于服务进程（`server/.env` 或环境变量），前端只调自有 `/api/chat`。验证方式是查产物里有没有密钥字样、看浏览器发出的外部请求是否为空。

## 代理转发流式响应必须关缓冲

- 症状：前端只收到一次完整响应或长时间无增量。
- 根因：nginx 默认开启 `proxy_buffering`，会把 SSE 攒在缓冲里；上游也可能被中间层聚合。
- 做法：`proxy_buffering off`、`proxy_cache off`、放宽 `proxy_read_timeout`，并回 `X-Accel-Buffering: no`；本机自验用真实 SSE 上游跑通增量渲染。

## 用 root 指静态目录会把部署位置钉死在 nginx 配置里

- 症状：换部署目录就要改 `/etc/nginx/conf.d/*.conf` 并 reload，配置里散落着文件系统路径。
- 根因：`root` / `alias` 表达的是"nginx 自己去磁盘找文件"，路径天然属于 nginx 配置；而 `proxy_pass` 只表达端口，进程换个目录重新起即可，nginx 无需改动。
- 做法：静态产物与 API 合并到一个 Node 进程（`server/index.mjs`），nginx 只做 `proxy_pass`。压缩等静态处理随之下沉到该进程（`createGzip`），不要在拆除 `root` 时把 nginx 里的 gzip 一并丢掉——那会让 236KB 的 JS 原样传输。

## 接入外部 API 密钥要先实测再写代码

- 症状：2026-10 接入 serper 搜索时，用户提供的密钥对三种查询参数（英文裸查询 / 英文带区域 / 中文带区域）全部返回 403 Unauthorized，而 jina reader 密钥同样环境下正常。
- 根因：密钥本身被服务端拒绝（失效、未激活或额度问题），与请求格式无关；若先写代码再测，会浪费在排查自己的实现上。
- 做法：拿到任何外部密钥，第一步用 curl 裸测（去掉自己代码的所有因素）确认连通性与状态码；工具调用失败时把状态码文本交还模型自行解释，而不是让 agent 循环崩溃。
