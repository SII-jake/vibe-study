import type { ReactNode } from 'react'

export interface CollapsibleSidebarProps {
  /** 当前是否收起；由 App 层持有状态并记偏好 */
  collapsed: boolean
  /** 收起/展开切换回调 */
  onToggle(collapsed: boolean): void
  children: ReactNode
}

/**
 * 左侧栏收展壳：展开时把传入的会话栏内容原样渲染出来并给「收起」入口；
 * 收起时把整个侧栏腾还给阅读区，只在主区左上角留一个悬浮的展开按钮。
 * 展开时附带一层点按收起遮罩：手机端侧栏以遮罩形态盖在主区上，此时
 * 点侧栏之外的区域（遮罩）也能收起，不只能找顶部按钮。
 * 状态由父级持有（要记偏好到 localStorage），这里只管受控渲染。
 */
export function CollapsibleSidebar({ collapsed, onToggle, children }: CollapsibleSidebarProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="sidebar-expand-btn"
        onClick={() => onToggle(false)}
        aria-label="展开左侧栏"
      >
        ☰
      </button>
    )
  }
  return (
    <>
      {/*
       * 点按收起遮罩：桌面端 display:none（宽屏点主区看内容不能误收侧栏）；
       * 手机端 fixed 满屏垫在侧栏（z-index 70）之下，拦截「点侧栏之外」的点按。
       */}
      <button
        type="button"
        className="drawer-backdrop"
        onClick={() => onToggle(true)}
        aria-label="点侧栏之外收起左侧栏"
        tabIndex={-1}
      />
      <aside className="app-sidebar">
        {/*
         * 收起入口固定放在侧栏顶部（设置那行的同一区域）：
         * 用户的预期位置是顶部挨着设置；曾经放底部导致用户找不到了
         * （「看不到点不到」的真正来源）。保持入流渲染，不用悬浮——
         * 悬浮曾压住设置（绝对定位的教训），入流在所有视口宽度下都
         * 有布局分配的空间，不可能被其它控件叠住。
         */}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => onToggle(true)}
          aria-label="收起左侧栏"
        >
          ◀
        </button>
        {children}
      </aside>
    </>
  )
}
