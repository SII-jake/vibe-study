package cn.sii.yjzhou.vibestudy;

import android.view.ActionMode;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

/**
 * 正文长按选择时，系统 ActionMode 菜单会与页面自己的「就这段提问」浮动按钮
 * 同时弹出（手机实测反馈）。Web 层没有 API 屏蔽系统菜单，因此在原生侧拦截：
 * 不可编辑区域（正文）浮现选择菜单立即 finish；焦点在输入框时放行，
 * 粘贴/全选菜单不受影响。
 *
 * 可编辑状态由页面同步：src/ui/selection-guard.ts 在 focusin/focusout 时
 * 通过桥对象回写；默认未同步前按不可编辑处理。
 */
public class MainActivity extends BridgeActivity {

    /** 页面回写：当前焦点是否在可编辑元素（输入框/文本域/contenteditable） */
    private volatile boolean editableFocused = false;

    @Override
    public void onResume() {
        super.onResume();
        // 桥在 onCreate 后才初始化；onResume 阶段 WebView 就绪。
        // 每次回到前台重新注册：页面 reload 后桥仍在，无副作用。
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new SelectionGuardBridge(), "VibeSelectionGuard");
        }
    }

    @Override
    public void onActionModeStarted(ActionMode mode) {
        if (!editableFocused) {
            // 正文区的系统选择菜单：立刻关掉，只留页面自己的浮动按钮
            mode.finish();
            return;
        }
        // 焦点在输入框：粘贴/全选等编辑菜单照常用
        super.onActionModeStarted(mode);
    }

    private class SelectionGuardBridge {
        @JavascriptInterface
        public void setEditableFocused(boolean focused) {
            editableFocused = focused;
        }
    }
}
