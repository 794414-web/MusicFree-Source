package `fun`.upup.musicfree.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
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
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * APK 下载并覆盖安装模块
 *
 * 下载策略：
 * - 统一使用 OkHttp 流式直连下载（进度由字节精确控制，网速可实时计算）
 * - 抛弃系统 DownloadManager（国产 ROM 上易卡住/报告 100% 但文件未写完）
 * - 下载完成后校验文件大小与 contentLength 一致，避免"进度 100 但安装失败"
 * - 下载失败通过事件 + getDownloadProgress 返回 -1 通知 JS 层自动切换备用链接
 */
class ApkUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ApkUpdate"
        private const val APK_FILE_NAME = "MusicFree-update.apk"
        private const val EVENT_NAME = "apkUpdateProgress"
        private const val ACTION_INSTALL_RESULT = "fun.upup.musicfree.INSTALL_RESULT"
    }

    private var installReceiverRegistered = false

    @Volatile
    private var lastError: String = ""
    @Volatile
    private var isDownloading = false
    @Volatile
    private var downloadedBytes = 0L
    @Volatile
    private var totalBytes = 0L
    @Volatile
    private var downloadFinishedVerified = false
    // 网速采样
    @Volatile
    private var currentSpeedBps = 0L
    @Volatile
    private var speedSampleBytes = 0L
    @Volatile
    private var speedSampleTime = 0L
    private var currentDownloadUrl: String = ""

    private val httpClient by lazy {
        OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
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
     * 多 URL 依次尝试，全部失败才报错。静态文件方案，简单稳定。
     */
    @ReactMethod
    fun checkUpdate(currentVersion: String, promise: Promise) {
        val urls = listOf(
            "https://gitee.com/ken794414/MusicFree-Source/raw/main/release/version.json",
            "https://raw.githubusercontent.com/794414-web/MusicFree-Source/main/release/version.json",
            "https://cdn.jsdelivr.net/gh/794414-web/MusicFree-Source@main/release/version.json"
        )
        Log.d(TAG, "checkUpdate: currentVersion=$currentVersion, urls=${urls.size}")

        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch {
            var lastError: String = ""
            var bodyStr: String? = null

            for ((index, url) in urls.withIndex()) {
                Log.d(TAG, "checkUpdate: try #${index + 1} $url")
                try {
                    val request = Request.Builder()
                        .url(url)
                        .header("Accept", "application/json")
                        .header("User-Agent", "MusicFree")
                        .build()

                    val response = httpClient.newCall(request).execute()
                    if (!response.isSuccessful) {
                        val code = response.code
                        response.close()
                        lastError = "HTTP $code"
                        Log.w(TAG, "checkUpdate: #${index + 1} failed HTTP $code")
                        continue
                    }

                    bodyStr = response.body?.string()
                    response.close()
                    if (bodyStr.isNullOrBlank()) {
                        lastError = "空响应"
                        Log.w(TAG, "checkUpdate: #${index + 1} empty response")
                        continue
                    }

                    Log.d(TAG, "checkUpdate: #${index + 1} success, ${bodyStr.length} bytes")
                    break
                } catch (e: Exception) {
                    Log.e(TAG, "checkUpdate: #${index + 1} exception", e)
                    lastError = when {
                        e is java.net.SocketTimeoutException -> "超时"
                        e is java.net.UnknownHostException -> "无法解析域名"
                        e is java.net.ConnectException -> "连接失败"
                        else -> e.message ?: "未知错误"
                    }
                }
            }

            if (bodyStr == null) {
                promise.reject("NETWORK", "检查更新失败（所有源均不可用，最后错误：$lastError）")
                return@launch
            }

            try {
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
                Log.e(TAG, "checkUpdate: parse response failed", e)
                promise.reject("PARSE", "解析版本信息失败: ${e.message}")
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
     * 下载 APK 并覆盖安装（OkHttp 直连优先，进度/网速精确可控）
     */
    @ReactMethod
    fun downloadAndInstall(url: String, promise: Promise) {
        lastError = ""
        isDownloading = true
        downloadFinishedVerified = false
        downloadedBytes = 0L
        totalBytes = 0L
        currentSpeedBps = 0L
        speedSampleBytes = 0L
        speedSampleTime = 0L
        currentDownloadUrl = url

        if (url.isBlank()) {
            lastError = "下载地址为空"
            isDownloading = false
            promise.reject("INVALID_URL", lastError)
            return
        }

        Log.d(TAG, "开始下载: $url")
        startDirectHttpDownload(url)
        // 立即返回，由 JS 层轮询 getDownloadProgress 获取进度/网速
        promise.resolve(0.0)
    }

    /**
     * 使用 OkHttp 流式下载 APK
     * 每次写入实时累加字节数，下载完成后校验文件完整性
     */
    private fun startDirectHttpDownload(url: String) {
        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch {
            var response: okhttp3.Response? = null
            try {
                val apkFile = apkFile()
                if (apkFile.exists()) apkFile.delete()

                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", "MusicFree-Update/1.0")
                    .header("Accept", "application/octet-stream, */*")
                    .build()

                Log.d(TAG, "OkHttp 开始请求: $url")
                response = httpClient.newCall(request).execute()
                if (!response!!.isSuccessful) {
                    throw IOException("下载失败: HTTP ${response!!.code}")
                }
                val body = response!!.body ?: throw IOException("下载失败: 空响应体")

                totalBytes = body.contentLength() // 可能为 -1（未知）
                if (totalBytes < 0) totalBytes = 0

                Log.d(TAG, "OkHttp 下载开始, 预计: ${if (totalBytes > 0) totalBytes / 1024 / 1024 else "未知"}MB")

                body.byteStream().use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var written = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            written += read
                            downloadedBytes = written
                        }
                        output.flush()
                    }
                }
                response?.close()
                response = null

                // 文件完整性校验：杜绝"进度 100 但实际未写完"
                val len = apkFile.length()
                if (len <= 0) throw IOException("下载文件为空")
                if (totalBytes > 0 && len != totalBytes) {
                    throw IOException("下载文件不完整 ($len/${totalBytes})")
                }

                Log.d(TAG, "OkHttp 下载完成并校验通过, 大小=${len}")

                downloadFinishedVerified = true
                reactContext.runOnNativeModulesQueueThread {
                    if (isDownloading) {
                        isDownloading = false
                        installApk()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "OkHttp 下载失败", e)
                try { response?.close() } catch (_: Exception) {}
                lastError = "下载失败: ${e.message}"
                reactContext.runOnNativeModulesQueueThread {
                    if (isDownloading) {
                        isDownloading = false
                        emitEvent("error", lastError)
                    }
                }
            }
        }
    }

    private fun apkFile(): File = File(
        reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
        APK_FILE_NAME
    )

    /**
     * 获取下载状态（进度 / 网速 / 累计字节）
     * 返回对象: { progress: Int, speed: Long(字节/秒), downloadedBytes: Long, totalBytes: Long }
     * progress 为 -1 表示下载失败
     */
    @ReactMethod
    fun getDownloadProgress(promise: Promise) {
        val result = Arguments.createMap()
        val now = System.currentTimeMillis()

        // 下载完成且校验通过
        if (downloadFinishedVerified) {
            result.putInt("progress", 100)
            result.putLong("speed", currentSpeedBps)
            result.putLong("downloadedBytes", downloadedBytes)
            result.putLong("totalBytes", totalBytes)
            promise.resolve(result)
            return
        }

        // 失败（未在下载）或无并发下载
        if (!isDownloading) {
            result.putInt("progress", -1)
            result.putLong("speed", 0)
            result.putLong("downloadedBytes", downloadedBytes)
            result.putLong("totalBytes", totalBytes)
            promise.resolve(result)
            return
        }

        // 实时网速采样（两次轮询间字节差 / 时间差）
        if (speedSampleTime > 0) {
            val dt = now - speedSampleTime
            if (dt > 0) {
                val db = downloadedBytes - speedSampleBytes
                currentSpeedBps = if (db >= 0) db * 1000 / dt else 0
            }
        }
        speedSampleBytes = downloadedBytes
        speedSampleTime = now

        val progress = if (totalBytes > 0) {
            min(downloadedBytes * 100 / totalBytes, 99L).toInt() // 未完成时最高 99
        } else {
            0
        }

        result.putInt("progress", progress.toInt())
        result.putLong("speed", currentSpeedBps)
        result.putLong("downloadedBytes", downloadedBytes)
        result.putLong("totalBytes", totalBytes)
        promise.resolve(result)
    }

    /**
     * 使用 PackageInstaller 覆盖安装 APK
     */
    private fun installApk() {
        try {
            val file = apkFile()
            if (!file.exists()) {
                lastError = "APK 文件不存在"
                emitEvent("error", lastError)
                return
            }

            Log.d(TAG, "准备覆盖安装 APK: ${file.absolutePath}, 大小=${file.length()}")

            val packageManager = reactContext.packageManager
            val packageInstaller = packageManager.packageInstaller

            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            ).apply {
                setAppPackageName(reactContext.packageName)
            }

            val sessionId = packageInstaller.createSession(params)
            val session = packageInstaller.openSession(sessionId)

            file.inputStream().use { input ->
                session.openWrite("MusicFree.apk", 0, file.length()).use { output ->
                    val buffer = ByteArray(64 * 1024)
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
            val file = apkFile()
            if (!file.exists()) {
                emitEvent("error", "APK 文件不存在")
                return
            }

            Log.d(TAG, "使用 ACTION_VIEW 回退安装: ${file.absolutePath}")

            val intent = Intent(Intent.ACTION_VIEW).apply {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    FileProvider.getUriForFile(
                        reactContext,
                        "${reactContext.packageName}.fileprovider",
                        file
                    )
                } else {
                    Uri.fromFile(file)
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