# 手机端点左侧栏之外的遮罩收起

## 背景

手机端左侧栏以遮罩形态盖在主区上（`max-width: 767px` 下 `position: fixed`），原本只能点侧栏顶部的 ◀ 收起——手小屏窄时够不着根部的目标太小，需要「点侧栏之外的区域也能收起」。

## 范围与非目标

- 只收敛手机端（窄视口）的收起入口；桌面端行为不变——宽屏下点主区看内容绝不能误收侧栏。
- 不改侧栏的开合状态归属（仍由 App 层持有并记 localStorage）。

## 考虑过的备选

1. document 级点击监听，判定落点在侧栏外则收起：需要区分窄/宽视口、处理事件冒泡与例外元素，逻辑散在组件外，且容易误吞主区的正常点击。
2. 遮罩元素只在窄屏才挂进 DOM（靠 matchMedia 传 prop）：组件要与视口状态耦合，App 层再透一层参数。
3. 恒渲染一个全屏遮罩 `button`，可见性完全交给 CSS（窄屏 `display: block`，桌面 `display: none`）：组件零状态零判断，行为唯一来源是媒体查询，与既有 `drawer-backdrop`/`app-sidebar` 的 z-index/定位体系共用一份口径。

## 最终方案与理由

选 3。`CollapsibleSidebar` 展开态恒渲染 `button.drawer-backdrop`（点击回调 `onToggle(true)`，z-index 50 垫在侧栏 70 之下），桌面端永远 `display: none`。零 JS 视口判断、零新增 prop，测试在 jsdom 下也能直接断言遮罩存在与点击回调，不依赖真实视口宽度。`.drawer-backdrop` 的样式在 styles.css 中本就存在（此前无对应元素，属预置样式），本次只是让它实至名归，并补了 button 默认样式复位。

## 遗留问题

- `drawer-backdrop` 作为 button 会进入键盘 tab 序无关的可访问性问题暂未深挖（`tabIndex={-1}` 已挡 tab，但屏幕阅读器仍会扫到）；移动端点按场景下影响可忽略，后续无障碍专项统一处理。
