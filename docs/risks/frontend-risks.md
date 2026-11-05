# 前端风险与踩坑

新条目加在本节最上方。

## spawn 常驻进程的唯一定论：setsid -f；`&`+disown 与 `(... &)` 都被实测抓到过卡死

- 症状：发布脚本工作全部完成（服务已健康）却挂在 do_wait 不退出，下游
  `bash release.sh | tail` 永远收不到输出。
- 根因：bash 对后台 job 的归属处理在 `(... &)`（子 shell 拍平）与 `& disown`
  （jobs 表摘除）两种写法下都仍可能把 spawn 的目标算到脚本子进程头上，
  退出前 wait 它；加之 node 继承脚本 stdout 的 pipe，下游 EOF 永远不来。
  最小复现曾给出互相矛盾的结果——bash 内部机理不值得纠缠。
- 做法：spawn 常驻进程只用一个定式：
  `setsid -f nohup <cmd> >>log 2>&1 </dev/null`，
  不加 `&`、不包子壳、不用 `$!`（PID 靠监听端口/cwd/cmdline 反查）。
  `-f` 强制 setsid 自身 fork 后立刻退出，目标进程从第一秒就与调用方零
  wait 关系；三向重定向到位（stdin 必须 /dev/null，std out/err 指日志文件），
  下游 pipe 形态（`| tail`/`| head`）下验证脚本正常退出才算合格。

## spawn 的后台 job 不 disown：脚本等价物是 do_wait 挂死、下游 pipe 永远等不到 EOF

- 症状：`bash scripts/release.sh 2>&1 | tail -N` 形态调用发布脚本时，脚本已完成
  全部工作（服务都健康了）但进程不退出，`tail` 也永远收不到输出。
- 根因：`(... setsid nohup node ... &)` 只解决了进程组/会话脱离，没解决两件事——
  ①bash 仍把后台 job 记在 job 表里，退出前 `do_wait` 等它；②node 继承脚本 stdout
  的 pipe fd，下游 `tail` 的生产者半数在 node 手里，EOF 永远不来。
- 做法：三条同时做到才算真的脱离——`setsid`（脱离会话）+ `disown`（出 job 表，
  bash 不再 wait）+ `</dev/null`（stdin 不接上游 fd）；stdout/stderr 必须显式重定向
  到日志文件，别让下游 pipe 被 spawn 的目标继承。隔离验证方式：用另一个端口模拟
  `bash x.sh | head -5`，head 能及时打满、脚本立即退出才算修到位。

## bash 包装脚本里 spawn 常驻进程：`$!` 拿到的可能是包装壳而非目标进程

- 症状：发布脚本 `(setsid nohup node server/index.mjs >> log 2>&1 & echo $! > pid)` 后，
  报告的"新后端 PID"是 `bash scripts/release.sh` 自己，真正 node 是它的子进程；
  脚本进程还因此卡住不退出。
- 根因：`bash <脚本>` 嵌套调用时，bash 为后台作业建包装子 shell，`$!` 取到的是作业
  的包装 PID；包装壳持有`目标进程后才 exec，exec 前 PID 被包装占用。
- 做法：spawn 常驻进程后不认 `$!`，按身份特征反查（监听端口 ∧ cwd=本仓库 ∧
  cmdline 前缀匹配，与 `scripts/release.sh` 的 `find_server_pid` 同一段）；
  反查不到宁可报错退出，不许拿错 PID 去杀或上报。spawn 行的尾括号写法
  `( ... & )` 也能避免包装壳残留。

## jsdom 没有布局引擎，布局回归在单元测试层不可见

- 症状：左栏收起后中右栏整片消失（`app-main` 实际宽 0），vitest 全绿。
- 根因：组件测试跑在 jsdom，jsdom 不算布局，grid 列宽与像素几何恒为 0，
  断言只能覆盖受控渲染（按钮在不在、回调对不对），覆盖不到「渲染后还剩多大」。
- 做法：布局类行为（宽高、可见性、裁切）的验收放真实浏览器 e2e，断言几何事实
  （`getBoundingClientRect().width`、可见元素数）；改动落在哪一层的能力域，验收就必须落在那一层，
  布局改动只在 jsdom 验等于没验。

## CSS grid auto-placement：absolute 子项不占位导致其余子项错位

- 症状：列模板从 `320px 1fr` 切到 `0 1fr` 后，主区被塞进 0 宽第一列，全部被 `overflow:hidden` 裁掉。
- 根因：展开按钮是 `position: absolute`，不参与网格占位；主区未显式指定列时，
  auto-placement 把它分配给了第一个网格项位置（0 宽列）。
- 做法：grid 容器列模板会动态切换、且容器内存在 absolute 定位子项时，常驻内容项显式钉列
  （如 `.app-main { grid-column: 2 }`），两态都消除 auto-placement 歧义；
  验证用 e2e 断言收起/展开两态下主区实际像素宽度。

## 同步采用远端快照时覆盖本端在途写入，险些丢数据

- 症状：多设备同步的轮询把远端快照采纳进本地状态时，本端防抖期内刚写入的消息（如刚落库的流式回答）会消失。
- 根因：合并只看了"已持久化的本地状态"，没看"还在防抖队列里、尚未上传的本地快照"；采用动作直接覆盖本端状态而不是与本端最新值再做一次合并。
- 做法：防抖快照参与一切合并（`poll` 里 `pendingLocal ?? getLocal()`）；`adoptRemote` 必须带基准快照，在 store 里与本端现值按同一基准三路并一次才落地。凡是"拿外部数据覆盖本地状态"的写法，都要问一句：覆盖瞬间本端有在途写入吗。

## 轮询无条件回推会造成多设备版本乒乓

- 症状：A 设备轮询发现远端更新 → 回推 → 版本 +1 → B 设备轮询发现版本变了 → 回推 → 互相把对方当成"有新数据"，版本号无限空转。
- 根因：多设备以版本号判断"有无新数据"，而回推本身也会产生版本号；合并结果与远端一致时回推毫无信息含量却照样抬高版本号。
- 做法：合并结果与远端一致（无回推价值）或与本地一致（无落盘价值）时跳过对应动作；deepEqual 判断先于落地与上传。凡是"检测到变更就写回"的循环，写回前先确认写回内容真的不同。


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
