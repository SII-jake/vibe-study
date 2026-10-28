/**
 * 中栏与右栏共用的时间轴。
 * 一次下潜里两者必须同方向同速度，否则用户会看到两块面板各自跳动
 * 而不是一条轨道整体左移。任何修改从这里改，不要两处分头调。
 */
export const DIVE_SLIDE_MS = 420
export const DIVE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
