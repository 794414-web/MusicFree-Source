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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * APK 下载并覆盖安装模块
 *
 * 下载策略：
 * 1. 优先使用系统 DownloadManager（可显示下载通知、断点续传）
 * 2. 若 DownloadManager 失败（返回 -1 或抛出异常），回退到 OkHttp 直接下载
 *    - OkHttp 支持自动跟随重定向、HTTPS、大文件
 *    - 特别适配 GitHub Release 的多层重定向链
 * 3. 下载完成后使用 PackageInstaller 覆盖安装
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
    private var lastError: String = ""
    private var isDownloading = false
    private var useOkHttpFallback = false
    private var fallbackDownloadedBytes = 0L
    private var fallbackTotalBytes = 0L
    private var lastProgressReportTime = 0L
    private var noProgressCount = 0
    private val httpClient by lazy {
        OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    private val downloadCompleteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) ?: -1
            if (id == downloadId && downloadId != -1L) {
                Log.d(TAG, "系统下载完成, downloadId=$id")
                val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val query = DownloadManager.Query().setFilterById(downloadId)
                var downloadSuccess = false
                dm.query(query)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            downloadSuccess = true
                        } else {
                            val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                            lastError = getDownloadFailReason(reason)
                            Log.e(TAG, "系统下载失败: $lastError")
                        }
                    }
                }
                if (downloadSuccess) {
                    isDownloading = false
                    installApk()
                } else {
                    isDownloading = false
                    emitEvent("error", lastError)
                }
                try {
                    reactContext.unregisterReceiver(this)
                    downloadReceiverRegistered = false
                } catch (_: Exception) {}
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
                    fallbackViewInstall()
                }
            }
            try {
                reactContext.unregisterReceiver(this)
                installReceiverRegistered = false
            } catch (_: Exception) {}
        }
    }

    override fun getName(): String = "ApkUpdate"

    /**
     * 检查更新（原生 OkHttp 实现，直接下载静态 version.json）
     * 不依赖任何 API，直接下载 Gitee Release 附件中的 version.json，
     * 简单可靠，不受 API 限流/鉴权影响
     */
    @ReactMethod
    fun checkUpdate(currentVersion: String, promise: Promise) {
        val url = "https://gitee.com/ken794414/MusicFree-Source/releases/download/v1.0.6/version.json"
        Log.d(TAG, "checkUpdate: currentVersion=$currentVersion")

        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch {
            try {
                val request = Request.Builder()
                    .url(url)
                    .header("Accept", "application/json")
                    .header("User-Agent", "MusicFree")
                    .build()

                val response = httpClient.newCall(request).execute()
                if (!response.isSuccessful) {
                    response.close()
                    if (response.code == 403) {
                        promise.reject("403", "更新文件访问受限，请检查网络")
                    } else if (response.code == 404) {
                        promise.reject("404", "未找到更新文件")
                    } else {
                        promise.reject("${response.code}", "检查更新失败: HTTP ${response.code}")
                    }
                    return@launch
                }

                val bodyStr = response.body?.string() ?: run {
                    response.close()
                    promise.reject("EMPTY", "检查更新失败: 空响应")
                    return@launch
                }
                response.close()

                val versionJson = JSONObject(bodyStr)
                val latestVersion = versionJson.optString("version", "")

                if (latestVersion.isEmpty()) {
                    promise.reject("NO_VERSION", "无法获取版本信息")
                    return@launch
                }

                val needUpdate = compareVersion(latestVersion, currentVersion) > 0
                if (!needUpdate) {
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("needUpdate", false)
                    })
                    return@launch
                }

                val changeLogArray = versionJson.optJSONArray("changeLog") ?: JSONArray()
                val downloadArray = versionJson.optJSONArray("download") ?: JSONArray()

                val changeLog = Arguments.createArray()
                for (i in 0 until changeLogArray.length()) {
                    changeLog.pushString(changeLogArray.optString(i, ""))
                }

                val download = Arguments.createArray()
                for (i in 0 until downloadArray.length()) {
                    download.pushString(downloadArray.optString(i, ""))
                }

                val result = Arguments.createMap().apply {
                    putBoolean("needUpdate", true)
                    putString("version", latestVersion)
                    putArray("changeLog", changeLog)
                    putArray("download", download)
                }

                Log.d(TAG, "checkUpdate: update available $currentVersion -> $latestVersion")
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "checkUpdate failed", e)
                val msg = when {
                    e is java.net.SocketTimeoutException -> "检查更新超时，请检查网络连接"
                    e is java.net.UnknownHostException -> "无法访问更新服务器: 网络连接失败"
                    else -> "检查更新失败: ${e.message}"
                }
                promise.reject("NETWORK", msg)
            }
        }
    }

    private fun compareVersion(v1: String, v2: String): Int {
        val parts1 = v1.split(".")
        val parts2 = v2.split(".")
        val maxLen = maxOf(parts1.size, parts2.size)
        for (i in 0 until maxLen) {
            val p1 = parts1.getOrNull(i)?.toIntOrNull() ?: 0
            val p2 = parts2.getOrNull(i)?.toIntOrNull() ?: 0
            if (p1 > p2) return 1
            if (p1 < p2) return -1
        }
        return 0
    }

    /**
     * 下载 APK 并覆盖安装
     * 优先系统 DownloadManager，失败时回退 OkHttp 直接下载
     */
    @ReactMethod
    fun downloadAndInstall(url: String, promise: Promise) {
        lastError = ""
        useOkHttpFallback = false
        fallbackDownloadedBytes = 0L
        fallbackTotalBytes = 0L
        lastProgressReportTime = System.currentTimeMillis()
        noProgressCount = 0
        currentDownloadUrl = url

        if (url.isBlank()) {
            lastError = "下载地址为空"
            promise.reject("INVALID_URL", lastError)
            return
        }

        Log.d(TAG, "开始下载: $url")
        isDownloading = true

        try {
            val apkFile = File(
                reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                APK_FILE_NAME
            )
            if (apkFile.exists()) {
                apkFile.delete()
            }

            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
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

            downloadId = dm.enqueue(request)
            Log.d(TAG, "DownloadManager enqueue: downloadId=$downloadId")

            if (downloadId == -1L) {
                Log.w(TAG, "DownloadManager 返回 -1，回退到 OkHttp")
                useOkHttpFallback = true
                startDirectHttpDownload(url)
                promise.resolve(0.0)
                return
            }

            registerDownloadReceiver()
            promise.resolve(downloadId.toDouble())
        } catch (e: Exception) {
            Log.w(TAG, "DownloadManager 异常，回退到 OkHttp: ${e.message}")
            try {
                if (downloadId != -1L) {
                    val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                    dm.remove(downloadId)
                    Log.d(TAG, "已取消 DownloadManager 下载: $downloadId")
                }
            } catch (_: Exception) {}
            try {
                reactContext.unregisterReceiver(downloadCompleteReceiver)
                downloadReceiverRegistered = false
            } catch (_: Exception) {}
            useOkHttpFallback = true
            startDirectHttpDownload(url)
            promise.resolve(0.0)
        }
    }

    /**
     * 使用 OkHttp 直接下载 APK
     * 这是 DownloadManager 失败后的兜底方案
     */
    private fun startDirectHttpDownload(url: String) {
        useOkHttpFallback = true
        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch {
            try {
                val apkFile = File(
                    reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    APK_FILE_NAME
                )
                if (apkFile.exists()) apkFile.delete()

                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", "MusicFree-Update/1.0")
                    .build()

                Log.d(TAG, "OkHttp 开始请求: $url")
                val response = httpClient.newCall(request).execute()
                if (!response.isSuccessful) {
                    lastError = "下载失败: HTTP ${response.code}"
                    Log.e(TAG, lastError)
                    reactContext.runOnNativeModulesQueueThread {
                        isDownloading = false
                        emitEvent("error", lastError)
                    }
                    return@launch
                }

                val body = response.body
                if (body == null) {
                    lastError = "下载失败: 空响应体"
                    reactContext.runOnNativeModulesQueueThread {
                        isDownloading = false
                        emitEvent("error", lastError)
                    }
                    return@launch
                }

                fallbackTotalBytes = body.contentLength()
                Log.d(TAG, "OkHttp 下载开始, 预计: ${fallbackTotalBytes / 1024 / 1024}MB")

                body.byteStream().use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(8192)
                        var downloaded = 0L
                        lastProgressReportTime = System.currentTimeMillis()

                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            downloaded += read
                            fallbackDownloadedBytes = downloaded

                            val now = System.currentTimeMillis()
                            if (now - lastProgressReportTime >= 300) {
                                lastProgressReportTime = now
                                Log.d(TAG, "OkHttp: ${downloaded}/${fallbackTotalBytes}")
                            }
                        }
                        output.flush()
                    }
                }

                response.close()
                Log.d(TAG, "OkHttp 下载完成, 大小=${apkFile.length()}")

                reactContext.runOnNativeModulesQueueThread {
                    isDownloading = false
                    installApk()
                }
            } catch (e: Exception) {
                Log.e(TAG, "OkHttp 下载失败", e)
                lastError = "下载失败: ${e.message}"
                reactContext.runOnNativeModulesQueueThread {
                    isDownloading = false
                    emitEvent("error", lastError)
                }
            }
        }
    }

    /**
     * 注册下载完成广播接收器
     */
    private fun registerDownloadReceiver() {
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
    }

    /**
     * 使用 PackageInstaller 覆盖安装 APK
     */
    private fun installApk() {
        try {
            val apkFile = File(
                reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                APK_FILE_NAME
            )
            if (!apkFile.exists()) {
                lastError = "APK 文件不存在"
                emitEvent("error", lastError)
                return
            }

            Log.d(TAG, "准备覆盖安装 APK: ${apkFile.absolutePath}, 大小=${apkFile.length()}")

            val packageManager = reactContext.packageManager
            val packageInstaller = packageManager.packageInstaller

            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            ).apply {
                setAppPackageName(reactContext.packageName)
            }

            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

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

            registerInstallReceiver()

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
            lastError = e.message ?: "安装失败"
            emitEvent("error", lastError)
        }
    }

    private fun registerInstallReceiver() {
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
    }

    private fun getDownloadFailReason(reason: Int): String = when (reason) {
        DownloadManager.ERROR_CANNOT_RESUME -> "无法恢复下载"
        DownloadManager.ERROR_DEVICE_NOT_FOUND -> "存储设备不可用"
        DownloadManager.ERROR_FILE_ALREADY_EXISTS -> "文件已存在"
        DownloadManager.ERROR_FILE_ERROR -> "文件读写错误"
        DownloadManager.ERROR_HTTP_DATA_ERROR -> "HTTP 数据错误"
        DownloadManager.ERROR_INSUFFICIENT_SPACE -> "存储空间不足"
        DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "重定向过多"
        DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "HTTP 状态码异常"
        DownloadManager.ERROR_UNKNOWN -> "未知下载错误"
        else -> "下载失败 (code=$reason)"
    }

    /**
     * 获取下载进度（0-100）
     * 根据下载模式返回对应进度
     */
    @ReactMethod
    fun getDownloadProgress(promise: Promise) {
        try {
            if (!isDownloading) {
                promise.resolve(if (useOkHttpFallback) 100 else -1)
                return
            }

            // OkHttp 回退模式：使用 fallback 变量计算进度
            if (useOkHttpFallback) {
                val progress = if (fallbackTotalBytes > 0) {
                    (fallbackDownloadedBytes * 100 / fallbackTotalBytes).toInt()
                } else {
                    (fallbackDownloadedBytes / 1024 / 1024).toInt().coerceAtMost(50)
                }
                promise.resolve(progress.coerceIn(0, 100))
                return
            }

            // DownloadManager 模式
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
                    Log.d(TAG, "DM status=$status")

                    when (status) {
                        DownloadManager.STATUS_RUNNING -> {
                            val downloaded = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                            val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))

                            // 检测是否卡住：进度为 0 且已经过了一段时间
                            if (downloaded == 0L) {
                                noProgressCount++
                                if (noProgressCount >= 20) {
                                    Log.w(TAG, "DownloadManager 卡住（进度0持续10秒），回退到 OkHttp")
                                    noProgressCount = 0
                                    val url = getDownloadUrl()
                                    if (url != null) {
                                        startDirectHttpDownload(url)
                                        promise.resolve(0)
                                        return
                                    }
                                }
                            } else {
                                noProgressCount = 0
                            }

                            if (total > 0) {
                                promise.resolve((downloaded * 100 / total).toInt())
                            } else {
                                promise.resolve(50)
                            }
                        }
                        DownloadManager.STATUS_PAUSED -> {
                            val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                            Log.w(TAG, "DownloadManager 暂停, reason=$reason")
                            noProgressCount++
                            if (noProgressCount >= 10) {
                                Log.w(TAG, "DownloadManager 暂停超过5秒，回退到 OkHttp")
                                noProgressCount = 0
                                val url = getDownloadUrl()
                                if (url != null) {
                                    startDirectHttpDownload(url)
                                    promise.resolve(0)
                                    return
                                }
                            }
                            promise.resolve(0)
                        }
                        DownloadManager.STATUS_FAILED -> {
                            val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                            lastError = getDownloadFailReason(reason)
                            Log.e(TAG, "DownloadManager 失败: $lastError")
                            promise.resolve(-1)
                        }
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            promise.resolve(100)
                        }
                        else -> {
                            promise.resolve(0)
                        }
                    }
                } else {
                    promise.resolve(-1)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "getDownloadProgress 异常", e)
            promise.resolve(-1)
        }
    }

    /**
     * 获取当前下载的 URL（用于回退时重新下载）
     */
    private var currentDownloadUrl: String = ""

    private fun getDownloadUrl(): String? {
        return if (currentDownloadUrl.isNotBlank()) currentDownloadUrl else null
    }

    @ReactMethod
    fun getLastError(promise: Promise) {
        promise.resolve(lastError)
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
        } catch (_: Exception) {}
    }
}
