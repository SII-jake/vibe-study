package cn.sii.yjzhou.vibestudy;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.view.ActionMode;
import android.webkit.JavascriptInterface;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;

/**
 * 两件原生职责：
 * 1) 正文长按屏蔽系统选择菜单：系统 ActionMode 菜单会与页面自己的「就这段提问」
  *    浮动按钮同时弹出（手机实测反馈）。Web 层没有 API 屏蔽系统菜单，因此在原生侧
  *    拦截：不可编辑区域（正文）浮现选择菜单立即 finish；焦点在输入框时放行。
  *    可编辑状态由页面同步：src/ui/selection-guard.ts 在 focusin/focusout 时
  *    通过 VibeSelectionGuard 桥对象回写；默认未同步前按不可编辑处理。
 * 2) 壳内 OTA：VibeAppUpdate 桥 —— 前端比对 /api/app-version 与当前版本后，
 *    走 DownloadManager 下载 APK、完成即拉起系统安装器。
 *    用户只需要在系统安装弹窗点一次「安装」，不再要微信转发安装包。
 * 3) 自签服务端证书放行（手机实测缺陷修复）：内网部署 8.153.198.42:18003 走
 *    nginx 自签证书，Android WebView 默认对不受信证书**静默断连**——启动页选
 *    这个地址手机"完全没有任何反应"。壳必须显式放行**白名单 host + 证书指纹
 *    双匹配**的那一台；其余任何 SSL 错误照常拦掉，不放行陌生自签站。
 * 4) 系统返回键分层（decisions/2026-11-19 §三.1）：有追问层开着时先退层、
 *    再退应用。前端 SessionView 通过 VibeBackKey 桥实时同步"有层可退"，
 *    按键时壳只同步读这一眼——有层则向页面发 vite-back 自定义事件让前端
 *    退一层；无层则交还系统默认（WebView 历史回退 / finish）。
 */
public class MainActivity extends BridgeActivity {

    /** 自签服务白名单（host + 证书 sha256 指纹的双匹配，见注释 3） */
    private static final String TRUSTED_HOST = "8.153.198.42";
    private static final String TRUSTED_CERT_SHA256 =
        "AF:3C:B1:3C:97:89:3C:F6:41:6F:C8:A7:30:93:D7:30:1B:D9:1E:16:06:E1:83:0F:00:ED:D6:EE:0C:0A:86:83";

    /** 页面回写：当前焦点是否在可编辑元素（输入框/文本域/contenteditable） */
    private volatile boolean editableFocused = false;

    /** 页面回写：当前是否还有追问层可退（SessionView 同步） */
    private volatile boolean vibeHasBackLayer = false;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android 15+ 强制 edge-to-edge：内容被画到系统状态栏后面，
        // 「＋新会话」与电量图标重叠（真机反馈）。decor 适配系统窗口即可
        // 回到「WebView 在状态栏之下」的布局；CSS 的 safe-top 兜底挖空场景。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        // SSL 放行见注释 3：白名单双匹配的 proceed，其余照样 cancel。
        // 必须继承 BridgeWebViewClient 而不是裸 WebViewClient——后者会顶掉
        // Capacitor 自己的请求拦截管线（本地资产服务/路由/错误页），导致启动页黑屏
        // （1.0.5 带病包已实测此坑并紧急下架，勿再犯）。
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                String host = error.getUrl() == null ? "" : Uri.parse(error.getUrl()).getHost();
                if (TRUSTED_HOST.equals(host) && certSha256Matches(error)) {
                    handler.proceed();
                } else {
                    handler.cancel();
                }
            }
        });

        // 返回键先问前端，不直接 finish（注释 4）：onBackPressedDispatcher 是
        // BridgeActivity 自带的注册口，本回调随 Activity 生命周期存活。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (isChatPage() && vibeHasBackLayer) {
                    // 有层可退：把决定交给前端——vite-back 事件由 SessionView 消费并退层
                    getBridge().getWebView().evaluateJavascript(
                        "document.dispatchEvent(new Event('vite-back', { cancelable: true }))", null);
                    return;
                }
                // 无层可退或还在启动页：交还 dispatcher 原本的行为
                // （WebView 历史回退/finish）——先摘回调防自我递归，分发后再挂回
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                if (!isFinishing()) {
                    getBridge().getWebView().post(() -> setEnabled(true));
                }
            }
        });
    }

    /** 当前是否在远程会话页（boot.js 启动阶段是 file:// 本地资产，不算会话页）。 */
    private boolean isChatPage() {
        if (getBridge() == null || getBridge().getWebView() == null) return false;
        String url = getBridge().getWebView().getUrl();
        return url != null && url.startsWith("http");
    }

    /** 证书 sha256 指纹与 TRUSTED_CERT_SHA256 比对；拿不到证书按不信任处理。 */
    private boolean certSha256Matches(SslError error) {
        try {
            X509Certificate cert = (X509Certificate) error.getCertificate().getX509Certificate();
            byte[] sha256 = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < sha256.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", sha256[i]));
            }
            return TRUSTED_CERT_SHA256.equalsIgnoreCase(sb.toString());
        } catch (Exception ignored) {
            return false;
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // 桥在 onCreate 后才初始化；onResume 阶段 WebView 就绪。
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new SelectionGuardBridge(), "VibeSelectionGuard");
            getBridge().getWebView().addJavascriptInterface(new AppUpdateBridge(), "VibeAppUpdate");
            getBridge().getWebView().addJavascriptInterface(new BackKeyBridge(), "VibeBackKey");
        }
    }

    private class BackKeyBridge {
        @JavascriptInterface
        public void setHasLayer(boolean hasLayer) {
            vibeHasBackLayer = hasLayer;
        }
    }

    @Override
    public void onActionModeStarted(ActionMode mode) {
        if (!editableFocused) {
            mode.finish();
            return;
        }
        super.onActionModeStarted(mode);
    }

    private class SelectionGuardBridge {
        @JavascriptInterface
        public void setEditableFocused(boolean focused) {
            editableFocused = focused;
        }
    }

    /** 壳内更新桥：版本读取 / 侧载权限 / 下载并拉起安装。 */
    private class AppUpdateBridge {

        /** 当前安装的版本号，与 build.gradle versionCode 一致；服务器端的比较基准。 */
        @JavascriptInterface
        public int getVersionCode() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return (int) info.getLongVersionCode();
                }
                @SuppressWarnings("deprecation")
                int legacy = info.versionCode;
                return legacy;
            } catch (PackageManager.NameNotFoundException error) {
                return 0;
            }
        }

        /** 当前安装的版本名（用户可见口径）；设置页「当前版本」展示用。 */
        @JavascriptInterface
        public String getVersionName() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return info.versionName == null ? "" : info.versionName;
            } catch (PackageManager.NameNotFoundException error) {
                return "";
            }
        }

        /** 是否已允许本应用安装未知来源包（Android 8+ 才检查，以下视为允许）。 */
        @JavascriptInterface
        public boolean hasUpdatePermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return getPackageManager().canRequestPackageInstalls();
            }
            return true;
        }

        /** 打开系统「安装未知应用」设置页；用户允许后回到启动页会重新走检查。 */
        @JavascriptInterface
        public void openUpdatePermissionSettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            }
        }

        /**
         * 下载并安装：DownloadManager 拉到应用外部文件目录（免存储权限、系统接管
         * 断网重试），完成后比对 SHA-256，一致才用 FileProvider 拉起安装器。
         *
         * @return 提交下载是否成功（失败场景多为 URL 非法/DownloadManager 未启用）
         */
        @JavascriptInterface
        public boolean downloadAndInstall(String url, String expectedSha256) {
            try {
                File target = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "vibe-study-update.apk");
                if (target.exists()) {
                    // 带版本指纹的服务端产物可能变化（重发同名包），旧文件一律作废重下
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                }

                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setTitle("vibe study 更新下载中");
                request.setDescription("下载完成后将自动拉起安装");
                request.setMimeType("application/vnd.android.package-archive");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
                request.setDestinationUri(Uri.fromFile(target));

                long downloadId = manager.enqueue(request);
                registerInstallReceiver(downloadId, target, expectedSha256);
                return true;
            } catch (IllegalArgumentException | IllegalStateException error) {
                return false;
            }
        }

        /** 一次性完成监听：校验 → 安装；失败即删除坏包，避免缓存坏包反复拉起。 */
        private void registerInstallReceiver(long downloadId, File target, String expectedSha256) {
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != downloadId) return;
                    context.unregisterReceiver(this);
                    if (!isDownloadSuccessful(downloadId)) return;
                    if (!Sha256Verifier.matches(target, expectedSha256)) {
                        //noinspection ResultOfMethodCallIgnored
                        target.delete();
                        return;
                    }
                    installApk(target);
                }
            };
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                //noinspection UnspecifiedRegisterReceiverFlag
                registerReceiver(receiver, filter);
            }
        }

        private boolean isDownloadSuccessful(long downloadId) {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
                if (cursor == null || !cursor.moveToFirst()) return false;
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                return status == DownloadManager.STATUS_SUCCESSFUL;
            }
        }

        private void installApk(File target) {
            Uri uri = FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                target
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException ignored) {
                // 极端 ROM 无安装器：静默失败，下次启动还会重新提示更新
            }
        }
    }

    /** SHA-256 校验：expected 为空（服务端未发布校验和）时仅按下载成功放行。 */
    private static class Sha256Verifier {
        static boolean matches(File file, String expectedSha256) {
            if (expectedSha256 == null || expectedSha256.isEmpty()) return true;
            try {
                java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
                try (java.io.InputStream in = new java.io.FileInputStream(file)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        digest.update(buffer, 0, read);
                    }
                }
                StringBuilder actual = new StringBuilder(64);
                for (byte b : digest.digest()) {
                    actual.append(String.format("%02x", b));
                }
                return actual.toString().equalsIgnoreCase(expectedSha256);
            } catch (Exception error) {
                return false;
            }
        }
    }
}
