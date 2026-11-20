package cn.sii.yjzhou.vibestudy;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.view.ActionMode;
import android.webkit.JavascriptInterface;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLPeerUnverifiedException;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.CertificateException;

/**
 * 两件原生职责：
 * 1) 正文长按屏蔽系统选择菜单：系统 ActionMode 菜单会与页面自己的「就这段提问」
  *    浮动按钮同时弹出（手机实测反馈）。Web 层没有 API 屏蔽系统菜单，因此在原生侧
  *    拦截：不可编辑区域（正文）浮现选择菜单立即 finish；焦点在输入框时放行。
  *    可编辑状态由页面同步：src/ui/selection-guard.ts 在 focusin/focusout 时
  *    通过 VibeSelectionGuard 桥对象回写；默认未同步前按不可编辑处理。
 * 2) 壳内 OTA：VibeAppUpdate 桥 —— 前端比对 /api/app-version 与当前版本后，
 *    由壳进程内下载 APK（18003 自签证书一对一钉证）、校验 SHA-256 后拉起系统安装器。
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
        // 真机反馈⑤：应用只有浅色主题——状态栏必须显式声明浅色（深色图标），
        // 白底下时间/电量才可读；系统按内容自动推断在 WebView 场景靠不住。
        new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView())
            .setAppearanceLightStatusBars(true);
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

            // 真机反馈①：非同源 http(s) 直达导航同样交系统浏览器——
            // 页面内 <a href> 直达与 window.open 是两条链路，都得拦。
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 1.0.8 登录跳转回退修复：还在本地壳资产（选服页 https://localhost 或
                // file://）时的 http 导航是"把 WebView 拉进会话页的那一跳"——host 与
                // 服务器天然不同源，绝不能按外链判；只有已在远程会话页里才谈外链。
                if (isChatPage() && isExternalHttpUrl(request.getUrl())) {
                    openInSystemBrowser(request.getUrl());
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });

        // 真机反馈①（外链链路本体）：window.open('_blank') 的目标由 WebChromeClient
        // 的 onCreateWindow 承接——外部页面一律转交系统浏览器，WebView 不承接、
        // 不产生外部历史；返回键不再掉进"看完文章回来像被重置"的坑。
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                WebView probe = new WebView(view.getContext());
                probe.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        Uri url = request.getUrl();
                        // window.open 的导航以发起页为基准重新判定：本地壳资产时放行原位加载，
                        // 是会话页时才收为外链（判口与 shouldOverrideUrlLoading 同一份 isChatPage）。
                        if (url != null && isChatPage() && isExternalHttpUrl(url)) {
                            openInSystemBrowser(url);
                        } else if (url != null) {
                            view.loadUrl(url.toString());
                        }
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(probe);
                resultMsg.sendToTarget();
                return true;
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
                // 真机反馈②：会话页无追问层可退时按无操作处理——boot 跳转后
                // WebView 历史栈底是"选择服务器"页，历史回退会把它翻出来；
                // 这里什么都不做。只有还在启动/选服页（!isChatPage()）才交还
                // 系统默认分发；先摘回调防自我递归，分发后再挂回。
                if (!isChatPage()) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    if (!isFinishing()) {
                        getBridge().getWebView().post(() -> setEnabled(true));
                    }
                }
            }
        });
    }

    /** 当前是否在远程会话页（boot.js 启动阶段是 file:// 本地资产或 https://localhost
     *  Capacitor 本地源，都不算会话页——不以"以 http 起头"鲁莽判定（1.0.9 回退教训：
     *  https://localhost 也是以 http 起头，选服页会被当成会话页看待）。 */
    private boolean isChatPage() {
        if (getBridge() == null || getBridge().getWebView() == null) return false;
        String url = getBridge().getWebView().getUrl();
        if (url == null || !url.startsWith("http")) return false;
        String host = Uri.parse(url).getHost();
        return host != null && !"localhost".equalsIgnoreCase(host);
    }

    /**
     * 非同源 http(s) 判定（真机反馈①）：以当前 WebView 已加载的服务器地址为基准，
     * 同源路径（应用内会话/静态资源/OA 下载页）原位放行，其余一律视为外链。
     * 注意：仅对 isChatPage() 阶段有意义——本地壳资产的 http 导航不在此管辖。
     */
    private boolean isExternalHttpUrl(Uri url) {
        if (url == null) return false;
        String scheme = url.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) return false;
        String currentUrl = getBridge().getWebView().getUrl();
        Uri current = currentUrl == null ? null : Uri.parse(currentUrl);
        if (current == null || current.getHost() == null) return true;
        return !current.getHost().equalsIgnoreCase(url.getHost());
    }

    /** 外部页面交系统浏览器；没浏览器可接时静默不跳（不破坏会话页状态）。 */
    private void openInSystemBrowser(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException ignored) {
            // 设备无浏览器：不打开，会话留在原地
        }
    }

    /** 证书的冒号分隔十六进制 SHA-256——certSha256Matches 与进程内钉证共用。 */
    private static String sha256Hex(X509Certificate cert) {
        try {
            byte[] sha256 = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < sha256.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", sha256[i]));
            }
            return sb.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    /** 证书 sha256 指纹与 TRUSTED_CERT_SHA256 比对；拿不到证书按不信任处理。 */
    private boolean certSha256Matches(SslError error) {
        try {
            return TRUSTED_CERT_SHA256.equalsIgnoreCase(
                sha256Hex((X509Certificate) error.getCertificate().getX509Certificate()));
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
         * 下载并安装：进程内把 APK 拉写到应用外部文件目录，完成后比对 SHA-256，
         * 一致才用 FileProvider 拉起安装器。
         *
         * @return 提交下载是否成功（URL/目标路径非法或目标文件系统不可用时失败）
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
                downloadInProcess(url, target, expectedSha256);
                return true;
            } catch (IllegalArgumentException | IllegalStateException error) {
                return false;
            }
        }

        /**
         * 进程内下载（真机反馈：系统下载器方案卡死在"下载中"——下载器在 App 进程外，
         * WebView 的 onReceivedSslError 放行管不到它，18003 自签证书握手即失败，
         * 下载永远完不成，安装界面永不弹），改为壳进程内下载并钉证。
         * http 直连；https 仅对 TRUSTED_HOST 一对一钉证（与 WebView 白名单同一枚指纹），
         * 其余 https 主机走系统信任链。完成→SHA-256 校验→拉起安装器；
         * 任何失败发 vibe-ota-failed 事件给启动页（让它能放行进入应用，不再傻等）。
         */
        private void downloadInProcess(String url, File target, String expectedSha256) {
            new Thread(() -> {
                // 真机反馈：手机网络慢/中途休眠 socket 会停滞，read timeout 单次
                // 中断后就该重试一次再当做网络错误——下载 3MB 的 APK 本身几秒
                // 能完成，反复超时那是真的断网，不应再占启动流程。
                for (int attempt = 0; attempt < 2; attempt++) {
                    File tmp = new File(target.getParent(), target.getName() + ".part");
                    try {
                        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                        if (conn instanceof HttpsURLConnection https) {
                            Uri uri = Uri.parse(url);
                            if (TRUSTED_HOST.equals(uri.getHost())) {
                                https.setSSLSocketFactory(pinnedSslSocketFactory());
                                https.setHostnameVerifier(pinnedHostnameVerifier());
                            }
                        }
                        conn.setConnectTimeout(10_000);
                        conn.setReadTimeout(60_000);
                        conn.connect();
                        if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                            notifyOtaFailed("http-" + conn.getResponseCode());
                            return;
                        }
                        try (InputStream in = conn.getInputStream();
                             FileOutputStream out = new FileOutputStream(tmp)) {
                            byte[] buffer = new byte[64 * 1024];
                            int read;
                            while ((read = in.read(buffer)) != -1) {
                                out.write(buffer, 0, read);
                            }
                        }
                        conn.disconnect();
                        if (!Sha256Verifier.matches(tmp, expectedSha256)) {
                            //noinspection ResultOfMethodCallIgnored
                            tmp.delete();
                            notifyOtaFailed("checksum");
                            return;
                        }
                        //noinspection ResultOfMethodCallIgnored
                        tmp.renameTo(target);
                        getBridge().getWebView().post(() -> installApk(target));
                        return;
                    } catch (java.net.SocketTimeoutException error) {
                        // 超时重试一次（吞掉第一轮的失败，不然用户看一眼"超时"
                        // 马上以为挂了）；两次都超时才真正算网络不通。
                        //noinspection ResultOfMethodCallIgnored
                        tmp.delete();
                        if (attempt == 1) {
                            notifyOtaFailed("timeout");
                        }
                    } catch (Exception error) {
                        //noinspection ResultOfMethodCallIgnored
                        tmp.delete();
                        notifyOtaFailed(error.getClass().getSimpleName());
                        return;
                    }
                }
            }).start();
        }

        /** 下载失败回填启动页：启动页收到后把"下载中"改成失败提示并放行进入应用。 */
        private void notifyOtaFailed(String reason) {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            String js = "document.dispatchEvent(new CustomEvent('vibe-ota-failed',"
                + " { detail: { reason: '" + reason + "' } }))";
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
        }

        /** 只对 TRUSTED_HOST 一对一钉证（证书指纹与 WebView 白名单同一枚）。 */
        private static SSLSocketFactory pinnedSslSocketFactory() throws Exception {
            TrustManager[] trustManagers = { new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                    throw new CertificateException("no client auth");
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                    if (chain.length == 0 || !TRUSTED_CERT_SHA256.equalsIgnoreCase(sha256Hex(chain[0]))) {
                        throw new CertificateException("certificate not pinned");
                    }
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            } };
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, trustManagers, null);
            return context.getSocketFactory();
        }

        /** 钉证证书的 hostname 校验：host 一致 + 握手证书指纹匹配才放行。 */
        private static HostnameVerifier pinnedHostnameVerifier() {
            return (hostname, session) -> {
                if (!TRUSTED_HOST.equals(hostname)) return false;
                try {
                    if (session.getPeerCertificates().length > 0) {
                        X509Certificate leaf = (X509Certificate) session.getPeerCertificates()[0];
                        return TRUSTED_CERT_SHA256.equalsIgnoreCase(sha256Hex(leaf));
                    }
                } catch (SSLPeerUnverifiedException ignored) {
                    // 拿不到对端证书按不信任处理
                }
                return false;
            };
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
