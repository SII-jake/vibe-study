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

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;

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
            getBridge().getWebView().addJavascriptInterface(new AppUpdateBridge(), "VibeAppUpdate");
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
>>>>>>> fix/manual-update
}
