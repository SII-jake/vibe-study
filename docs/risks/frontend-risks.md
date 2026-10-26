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

## 手机浏览器直连模型接口受 CORS 限制

- 症状：配置填好后请求失败，报跨域错误。
- 根因：纯前端应用没有后端中转，浏览器会拦截对方未声明 `Access-Control-Allow-Origin` 的响应；密钥也随请求头暴露在浏览器侧。
- 做法：设置页显式提示需要对方允许跨域，必要时改用自建代理或带 CORS 的网关；本机自验时用带 CORS 头的本地模拟服务跑通链路。
