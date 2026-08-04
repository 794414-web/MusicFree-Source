package `fun`.upup.musicfree.update

import android.app.DownloadManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * APK 下载并覆盖安装模块
 *
 * 流程：
 * 1. downloadAndInstall(url) — 使用 DownloadManager 下载 APK
 * 2. 下载完成后使用 PackageInstaller 进行覆盖安装（保留应用数据）
 * 3. 若 PackageInstaller 失败，回退到 ACTION_VIEW 方式
 * 4. JS 层可通过事件监听下载进度和安装状态
 *
 * 覆盖安装说明：
 * - 通过 setAppPackageName 明确指定目标包名，确保替换已安装的同名应用
 * - 相同包名 + 相同签名时，系统会保留应用数据并覆盖安装
 */
class ApkUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ApkUpdate"
        private const val APK_FILE_NAME = "MusicFree-update.apk"
        private const val EVENT_NAME = "apkUpdateProgress"
        private const val ACTION_INSTALL_RESULT = "fun.upup.musicfree.INSTALL_RESULT"
        private const val EXTRA_SESSION_ID = "extra_session_id"
    }

    private var downloadId: Long = -1
    private var downloadReceiverRegistered = false
    private var installReceiverRegistered = false

    private val downloadCompleteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) ?: -1
            if (id == downloadId && downloadId != -1L) {
                Log.d(TAG, "下载完成, downloadId=$id")
                installApk()
                try {
                    reactContext.unregisterReceiver(this)
                    downloadReceiverRegistered = false
                } catch (e: Exception) {
                    // ignore
                }
            }
        }
    }

    private val installResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val status = intent?.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) ?: -1
            val msg = intent?.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
            when (status) {
                PackageInstaller.STATUS_SUCCESS -> {
                    Log.d(TAG, "覆盖安装成功")
                    emitEvent("installed", "安装成功")
                }
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    // 系统需要用户确认覆盖安装，弹出确认界面
                    val confirmIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent?.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent?.getParcelableExtra(Intent.EXTRA_INTENT)
                    }
                    confirmIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    confirmIntent?.let { reactContext.startActivity(it) }
                    Log.d(TAG, "等待用户确认覆盖安装")
                }
                else -> {
                    Log.e(TAG, "覆盖安装失败: status=$status, msg=$msg")
                    // PackageInstaller 失败时回退到 ACTION_VIEW
                    fallbackViewInstall()
                }
            }
            try {
                reactContext.unregisterReceiver(this)
                installReceiverRegistered = false
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    override fun getName(): String = "ApkUpdate"

    /**
     * 下载 APK 并覆盖安装
     */
    @ReactMethod
    fun downloadAndInstall(url: String, promise: Promise) {
        try {
            if (url.isBlank()) {
                promise.reject("INVALID_URL", "下载地址为空")
                return
            }

            Log.d(TAG, "开始下载: $url")

            // 清理旧 APK
            val apkFile = File(
                reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                APK_FILE_NAME
            )
            if (apkFile.exists()) {
                apkFile.delete()
            }

            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle("MusicFree 更新")
                setDescription("正在下载最新版本 APK...")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                setDestinationInExternalFilesDir(
                    reactContext,
                    Environment.DIRECTORY_DOWNLOADS,
                    APK_FILE_NAME
                )
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
            }

            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadId = dm.enqueue(request)
            Log.d(TAG, "已加入下载队列, downloadId=$downloadId")

            // 注册下载完成广播
            if (!downloadReceiverRegistered) {
                val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    reactContext.registerReceiver(
                        downloadCompleteReceiver,
                        filter,
                        Context.RECEIVER_NOT_EXPORTED
                    )
                } else {
                    @Suppress("DEPRECATION")
                    reactContext.registerReceiver(downloadCompleteReceiver, filter)
                }
                downloadReceiverRegistered = true
            }

            promise.resolve(downloadId)
        } catch (e: Exception) {
            Log.e(TAG, "下载失败", e)
            promise.reject("DOWNLOAD_FAILED", e.message)
        }
    }

    /**
     * 使用 PackageInstaller 覆盖安装 APK（保留应用数据）
     * 相同包名 + 相同签名时，系统会替换已有应用并保留数据
     */
    private fun installApk() {
        try {
            val apkFile = File(
                reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                APK_FILE_NAME
            )
            if (!apkFile.exists()) {
                Log.e(TAG, "APK 文件不存在")
                emitEvent("error", "APK 文件不存在")
                return
            }

            Log.d(TAG, "准备覆盖安装 APK: ${apkFile.absolutePath}, 大小=${apkFile.length()}")

            val packageManager = reactContext.packageManager
            val packageInstaller = packageManager.packageInstaller

            // 创建安装参数，明确为全量安装（覆盖已有应用）
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            ).apply {
                // 设置目标应用包名，确保覆盖安装同包名的应用并保留数据
                setAppPackageName(reactContext.packageName)
            }

            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

            // 将 APK 文件内容写入安装 session
            apkFile.inputStream().use { input ->
                session.openWrite("MusicFree.apk", 0, apkFile.length()).use { output ->
                    val buffer = ByteArray(8192)
                    var read: Int
                    while (input.read(buffer).also { read = it } != -1) {
                        output.write(buffer, 0, read)
                    }
                    session.fsync(output)
                }
            }

            // 注册安装结果接收器
            if (!installReceiverRegistered) {
                val filter = IntentFilter(ACTION_INSTALL_RESULT)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    reactContext.registerReceiver(
                        installResultReceiver,
                        filter,
                        Context.RECEIVER_NOT_EXPORTED
                    )
                } else {
                    @Suppress("DEPRECATION")
                    reactContext.registerReceiver(installResultReceiver, filter)
                }
                installReceiverRegistered = true
            }

            // 创建 PendingIntent 接收安装结果
            val intent = Intent(ACTION_INSTALL_RESULT).apply {
                setPackage(reactContext.packageName)
                putExtra(EXTRA_SESSION_ID, sessionId)
            }
            val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    PendingIntent.FLAG_MUTABLE
                } else {
                    0
                }
            val pendingIntent = PendingIntent.getBroadcast(
                reactContext,
                sessionId,
                intent,
                pendingFlags
            )

            // 提交安装请求（覆盖安装）
            session.commit(pendingIntent.intentSender)
            Log.d(TAG, "已提交覆盖安装请求, sessionId=$sessionId")
            emitEvent("installing", "")
        } catch (e: Exception) {
            Log.e(TAG, "PackageInstaller 覆盖安装失败，回退到 ACTION_VIEW", e)
            fallbackViewInstall()
        }
    }

    /**
     * 回退安装方式：使用 ACTION_VIEW 启动系统安装界面
     * 这种方式在包名 + 签名一致时同样是覆盖安装（保留数据）
     */
    private fun fallbackViewInstall() {
        try {
            val apkFile = File(
                reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                APK_FILE_NAME
            )
            if (!apkFile.exists()) {
                emitEvent("error", "APK 文件不存在")
                return
            }

            Log.d(TAG, "使用 ACTION_VIEW 回退安装: ${apkFile.absolutePath}")

            val intent = Intent(Intent.ACTION_VIEW).apply {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    FileProvider.getUriForFile(
                        reactContext,
                        "${reactContext.packageName}.fileprovider",
                        apkFile
                    )
                } else {
                    Uri.fromFile(apkFile)
                }
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            reactContext.startActivity(intent)
            Log.d(TAG, "已启动安装界面（覆盖安装）")
            emitEvent("installing", "")
        } catch (e: Exception) {
            Log.e(TAG, "ACTION_VIEW 安装失败", e)
            emitEvent("error", e.message ?: "安装失败")
        }
    }

    /**
     * 获取下载进度（0-100）
     */
    @ReactMethod
    fun getDownloadProgress(promise: Promise) {
        try {
            if (downloadId == -1L) {
                promise.resolve(-1)
                return
            }
            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val query = DownloadManager.Query().setFilterById(downloadId)
            val cursor: Cursor = dm.query(query) ?: run {
                promise.resolve(-1)
                return
            }
            cursor.use {
                if (it.moveToFirst()) {
                    val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    if (status == DownloadManager.STATUS_RUNNING) {
                        val downloaded = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                        val total = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                        if (total > 0) {
                            val progress = downloaded * 100 / total
                            promise.resolve(progress)
                        } else {
                            promise.resolve(0)
                        }
                    } else if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        promise.resolve(100)
                    } else {
                        promise.resolve(0)
                    }
                } else {
                    promise.resolve(-1)
                }
            }
        } catch (e: Exception) {
            promise.resolve(-1)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun emitEvent(type: String, message: String) {
        try {
            val params = Arguments.createMap()
            params.putString("type", type)
            params.putString("message", message)
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_NAME, params)
        } catch (e: Exception) {
            // ignore
        }
    }
}
