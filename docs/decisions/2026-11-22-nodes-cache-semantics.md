# 同步读口的缓存语义：ETag 区分内容编码，Vary 覆盖全部响应

日期：2026-11-22。本文改动的背景是用户报的 Debug 窗口红色报错，非新功能。

## 背景

上一批为治"页面卡死"给 `GET /api/nodes` 加了 gzip 与 ETag/304。真机复测后页面正常，但
Debug 窗口出现 `GET /api/nodes (failed) net::ERR_CONTENT_LENGTH_MISMATCH`。

根因是那批改动自身的缺陷：ETag 只由库版本号决定，于是 gzip（999,743 字节）与
identity（2,244,092 字节）两个字节流完全不同的表示共用同一个实体标签 `"nodes-<版本>"`；
同时 identity 的 200 与所有 304 都只带了 `Content-Encoding` 分支上的 `Vary`，identity 路径漏了。
浏览器按 URL 存缓存条目、用同一 ETag 当校验基准，内容编码一换长度就对不上，整个请求被判失败。

服务端本身没有算错长度：25 次完整读取、单连接 keep-alive 连发、4 路并发、以及原始 socket
逐字节核对，声明长度与实收字节全部一致（999,743 = 999,743）；进程 13 分钟未重启、无 fd 泄漏、
20~50 次中断压测无未捕获异常。问题出在缓存语义而非传输实现。

## 范围与非目标

- 只动 `GET /api/nodes` 的响应头与 `web/src/index.html` 的图标声明。
- 不动同步协议、不碰数据形态（`baseVersion` 乐观锁、整棵快照语义均不变）。
- 不动 nginx 配置，不在服务端开启 `proxy_buffering off` 之类影响全局的项。
- 不追求把 976 KB 的快照再压小（剥离 `web_search_tool_result` 属语义取舍，另议）。

## 考虑过的备选

1. **只补 `Vary`，沿用同一 ETag**：否决。`Vary` 只解决缓存分发，不解决校验基准；
   两个表示仍共用标签，条件请求仍会拿 gzip 的标签去校验 identity 的字节流。
   按 RFC 9110 §8.8.1，内容编码是"所选表示"的组成部分，不同编码必须有不同的实体标签。
2. **关掉 gzip 回退到 identity**：否决。2.24 MB 未压缩在 180 KB/s 出网链路上要 12.5 秒，
   正是上一批要治的问题，退回去等于放弃收益。
3. **给 `Vary` 只在 gzip 分支加**：否决。304 是最需要 `Vary` 的响应——它没有 body，
   缓存只能靠头判断这份缓存的表示是否还适用于当前请求头。
4. **ETag 用响应体的哈希**：否决。每次请求都要对 2.24 MB 做一次哈希，成本高于收益；
   版本号已是快照的唯一标识（每次 `save` 递增），加上编码后缀就足以区分两个表示。

## 最终方案与理由

- **ETag 带编码后缀**：`"nodes-<版本>"`（identity）与 `"nodes-<版本>-gzip"`（gzip）。
  后缀与实际是否压缩保持一致——体积小于压缩阈值时 `sendMaybeGzip` 并不压缩，此时表示仍是
  identity，标签因此也不带后缀（否则同一条 MISMATCH 换个体积就复现）。
- **`Vary: Accept-Encoding` 提到公共头**，200 与 304 全路径都带。
- **`Accept-Ranges: none`**：JSON 快照不做分段传输，明确告知客户端别试 Range，
  免得它按 Range 续传时收到整份 200 而误判长度。
- **favicon 用内联 SVG data URI 声明**：站点此前从未声明图标，浏览器自动请求 `/favicon.ico`
  而该文件不存在，每次开页一条 404。data URI 连额外请求都省掉，也避免为一张图标新增
  构建产物与静态路由。

## 遗留问题

- Debug 窗口第三条 `cdn.deepseek.com/site-icons/... net::ERR_BLOCKED_BY_ORB` 不在本项目控制内：
  图标 URL 由上游检索结果的 `metadata.site_icon` 给出，CDN 侧不可用或拒绝跨源读取。
  前端 `FallbackImage` 已有 `onError` 兜底，会退化为链接图标，功能与观感均不受影响，
  本次不做处理；若长期在意控制台干净，可考虑改为服务端代理取图或直接不渲染远端图标。
- 首次全量拉取 gzip 后仍约 976 KB（180 KB/s 下约 5.6 秒）。再降需要剥离会话里的
  检索原文（`web_search_tool_result` 占 H3 会话 68%），属数据语义取舍，留待单独讨论。
