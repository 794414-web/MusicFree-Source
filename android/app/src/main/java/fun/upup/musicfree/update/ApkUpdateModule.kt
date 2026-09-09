package `fun`.upup.musicfree.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
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
import kotlinx.coroutines.Job
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

        // version.json 三线回退地址（Gitee raw → GitHub raw → jsDelivr CDN）
        // 修改仓库路径时只需改这里，无需在 checkUpdate 方法体内搜索
        private val VERSION_JSON_URLS = listOf(
            "https://gitee.com/ken794414/MusicFree-Source/raw/main/release/version.json",
            "https://raw.githubusercontent.com/794414-web/MusicFree-Source/main/release/version.json",
            "https://cdn.jsdelivr.net/gh/794414-web/MusicFree-Source@main/release/version.json"
        )
    }

    private var installReceiverRegistered = false
    private var downloadJob: Job? = null
    private var activeCall: okhttp3.Call? = null
    @Volatile
    private var downloadGeneration = 0

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
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                return
            }
            unregisterInstallReceiver()
        }
    }

    override fun getName(): String = "ApkUpdate"

    /**
     * 检查更新（原生 OkHttp 实现，直接下载静态 version.json）
     * 多 URL 依次尝试，全部失败才报错。静态文件方案，简单稳定。
     */
    @ReactMethod
    fun checkUpdate(currentVersion: String, promise: Promise) {
        val urls = VERSION_JSON_URLS
        Log.d(TAG, "checkUpdate: currentVersion=$currentVersion, urls=${urls.size}")

        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch {
            var lastError: String = ""
            var versionJson: JSONObject? = null

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

                    val bodyStr = response.body?.string()
                    response.close()
                    if (bodyStr.isNullOrBlank()) {
                        lastError = "空响应"
                        Log.w(TAG, "checkUpdate: #${index + 1} empty response")
                        continue
                    }

                    val parsed = try {
                        JSONObject(bodyStr)
                    } catch (e: Exception) {
                        lastError = "响应不是有效 JSON"
                        Log.w(TAG, "checkUpdate: #${index + 1} invalid JSON", e)
                        continue
                    }
                    if (parsed.optString("version", "").isBlank()) {
                        lastError = "版本字段缺失"
                        Log.w(TAG, "checkUpdate: #${index + 1} missing version")
                        continue
                    }
                    versionJson = parsed
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

            if (versionJson == null) {
                promise.reject("NETWORK", "检查更新失败（所有源均不可用，最后错误：$lastError）")
                return@launch
            }

            try {
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
     * 下载 APK 并覆盖安装：优先下载层多源自动回退
     * - 接收「单一 URL」模式：向后兼容 JS 层旧的 fromUrl/backUrl 逻辑
     * - 接收「JSON 数组字符串」模式（新）：形如 ["url1","url2",...]，原生端按顺序自动依次尝试，
     *   每条独立做 HTTP 状态 / 超时 / 文件完整性 校验，失败后自动切到下一条；
     *   全部失败时聚合每条错误明细，按「#i 简短域名: 错误」返回，便于 UI Toast 直接展示。
     */
    @ReactMethod
    fun downloadAndInstall(urlOrJsonList: String, promise: Promise) {
        cancelActiveDownload()
        val generation = downloadGeneration
        lastError = ""
        aggregatedFailures.clear()
        isDownloading = true
        downloadFinishedVerified = false
        downloadedBytes = 0L
        totalBytes = 0L
        currentSpeedBps = 0L
        speedSampleBytes = 0L
        speedSampleTime = 0L
        currentDownloadUrl = ""

        val urls = parseDownloadUrls(urlOrJsonList)
        if (urls.isEmpty()) {
            lastError = "下载地址为空"
            isDownloading = false
            promise.reject("INVALID_URL", lastError)
            return
        }

        Log.d(TAG, "开始下载 (${urls.size} 条链路): $urls")
        // 并发仍使用串行队列：失败后可有序切换，便于按「国内优先」的数组顺序真正落地
        startMultiSourceHttpDownload(urls, urlIndex = 0, generation)
        // 立即返回，由 JS 层轮询 getDownloadProgress 获取进度/网速
        promise.resolve(0.0)
    }

    /**
     * 将「单 URL 或 JSON 数组字符串」解析为有序下载列表
     */
    private fun parseDownloadUrls(input: String): List<String> {
        val raw = input.trim()
        if (raw.isEmpty()) return emptyList()
        if (raw.startsWith("[") && raw.endsWith("]")) {
            return try {
                val arr = JSONArray(raw)
                val list = mutableListOf<String>()
                for (i in 0 until arr.length()) {
                    val s = arr.optString(i, "").trim()
                    if (s.isNotEmpty()) list.add(s)
                }
                list
            } catch (_: Exception) {
                // 解析失败回退为「把输入当单一 URL」
                listOf(raw).filter { it.isNotBlank() }
            }
        }
        return listOf(raw).filter { it.isNotBlank() }
    }

    /** 每条链路的失败详情：用于全部失败后聚合错误 */
    private data class FailureInfo(val index: Int, val url: String, val reason: String)
    private val aggregatedFailures = mutableListOf<FailureInfo>()

    private fun shortLabelOfUrl(url: String): String = try {
        val u = java.net.URI(url)
        val host = u.host ?: "?"
        val short = if (host.startsWith("www.")) host.substring(4) else host
        // 保留一级路径片段，避免同域名多条链接无辨识度
        val first = u.path?.trim('/')?.takeIf { it.isNotBlank() }?.split('/')?.firstOrNull()
        if (first != null) "$host/$first" else short
    } catch (_: Exception) {
        url.take(24)
    }

    /**
     * OkHttp 直链多源回退下载：
     * - 每条链路独立发出请求、独立计算 contentLength、独立写同一个临时文件（先写 .part，成功后重命名）。
     * - 失败后先记录聚合，再按序启动下一条；若全部失败，统一走事件回调通知 UI 展示明细。
     */
    private fun startMultiSourceHttpDownload(
        urls: List<String>,
        urlIndex: Int,
        generation: Int
    ) {
        if (!isDownloadActive(generation)) return
        val scope = CoroutineScope(Dispatchers.IO)
        downloadJob = scope.launch {
            if (!isDownloadActive(generation)) return@launch
            if (urlIndex >= urls.size) {
                // 所有源均不可用
                isDownloading = false
                val summary = buildString {
                    append("全部下载源失败：")
                    aggregatedFailures.forEachIndexed { i, f ->
                        if (i > 0) append("；")
                        append('#')
                        append(f.index + 1)
                        append(' ')
                        append(shortLabelOfUrl(f.url))
                        append(": ")
                        append(f.reason)
                    }
                }
                lastError = summary
                Log.e(TAG, summary)
                reactContext.runOnNativeModulesQueueThread {
                    emitEvent("error", summary)
                }
                return@launch
            }

            val url = urls[urlIndex]
            currentDownloadUrl = url
            // 切换新链接时重置进度/网速 UI（JS 轮询会读到新的从 0 开始的数字，看起来更正常）
            downloadedBytes = 0L
            totalBytes = 0L
            speedSampleBytes = 0L
            speedSampleTime = 0L
            emitEvent("fallback", "正在尝试下载源 #${urlIndex + 1} (${shortLabelOfUrl(url)})")

            var response: okhttp3.Response? = null
            var call: okhttp3.Call? = null
            try {
                val apkFile = apkFile()
                if (apkFile.exists()) apkFile.delete()

                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 MusicFree-Update/1.0")
                    .header("Accept", "application/vnd.android.package-archive, application/octet-stream, */*")
                    .apply {
                        try {
                            val host = java.net.URI(url).host
                            if (host != null) header("Referer", "https://$host/")
                        } catch (_: Exception) {}
                    }
                    .build()

                Log.d(TAG, "[#${urlIndex + 1}] OkHttp 开始请求: $url")
                call = httpClient.newCall(request)
                activeCall = call
                response = call.execute()
                if (!response!!.isSuccessful) {
                    val code = response!!.code
                    response.close()
                    throw IOException("HTTP $code")
                }
                val body = response!!.body ?: throw IOException("空响应体")

                totalBytes = body.contentLength().coerceAtLeast(0L)
                Log.d(TAG, "[#${urlIndex + 1}] OkHttp 下载开始, 预计: ${if (totalBytes > 0) "${totalBytes / 1024 / 1024}MB" else "未知"}")

                val crc = java.util.zip.CRC32()
                body.byteStream().use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var written = 0L
                        while (true) {
                            if (!isDownloadActive(generation)) throw IOException("下载已取消")
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            crc.update(buffer, 0, read)
                            written += read
                            downloadedBytes = written
                        }
                        output.flush()
                    }
                }
                response?.close()
                response = null

                val len = apkFile.length()
                if (len <= 0) throw IOException("下载文件为空")
                // 内容长度不匹配（且服务端真的返回了 Content-Length）时才视为失败
                if (totalBytes > 0 && len != totalBytes) {
                    throw IOException("下载文件不完整 ($len/$totalBytes)")
                }
                validateApk(apkFile)

                Log.d(TAG, "[#${urlIndex + 1}] OkHttp 下载完成并校验通过, 大小=$len, crc32=${crc.value.toString(16)}")

                downloadFinishedVerified = true
                reactContext.runOnNativeModulesQueueThread {
                    if (isDownloadActive(generation)) {
                        isDownloading = false
                        installApk()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "[#${urlIndex + 1}] 下载失败", e)
                try { response?.close() } catch (_: Exception) {}
                activeCall = null
                if (!isDownloadActive(generation)) {
                    return@launch
                }
                val reason = e.message ?: "未知错误"
                aggregatedFailures.add(FailureInfo(urlIndex, url, reason))
                startMultiSourceHttpDownload(urls, urlIndex + 1, generation)
            } finally {
                if (activeCall === call) {
                    activeCall = null
                }
            }
        }
    }

    private fun apkFile(): File = File(
        reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
        APK_FILE_NAME
    )

    private fun isDownloadActive(generation: Int): Boolean =
        isDownloading && generation == downloadGeneration

    private fun cancelActiveDownload() {
        downloadGeneration += 1
        isDownloading = false
        activeCall?.cancel()
        activeCall = null
        downloadJob?.cancel()
        downloadJob = null
    }

    private fun validateApk(file: File) {
        file.inputStream().use { input ->
            val signature = ByteArray(4)
            if (input.read(signature) != signature.size ||
                signature[0] != 0x50.toByte() ||
                signature[1] != 0x4b.toByte() ||
                signature[2] != 0x03.toByte() ||
                signature[3] != 0x04.toByte()
            ) {
                throw IOException("下载内容不是有效 APK")
            }
        }
        val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.PackageInfoFlags.of(0)
            )
        } else {
            @Suppress("DEPRECATION")
            reactContext.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
        } ?: throw IOException("无法读取 APK 包信息")
        if (packageInfo.packageName != reactContext.packageName) {
            throw IOException("APK 包名不匹配")
        }
        val archiveVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
        val installedInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
        val installedVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            installedInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            installedInfo.versionCode.toLong()
        }
        if (archiveVersionCode <= installedVersionCode) {
            throw IOException("APK 版本码未高于当前版本")
        }
    }

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
            // putLong 在部分 RN 构建下会触发 UnsatisfiedLinkError，改用 putDouble（ReactMethod 参数不受影响，精度足够）
            result.putDouble("speed", currentSpeedBps.toDouble())
            result.putDouble("downloadedBytes", downloadedBytes.toDouble())
            result.putDouble("totalBytes", totalBytes.toDouble())
            promise.resolve(result)
            return
        }

        // 失败（未在下载）或无并发下载
        if (!isDownloading) {
            result.putInt("progress", -1)
            result.putDouble("speed", 0.0)
            result.putDouble("downloadedBytes", downloadedBytes.toDouble())
            result.putDouble("totalBytes", totalBytes.toDouble())
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
        result.putDouble("speed", currentSpeedBps.toDouble())
        result.putDouble("downloadedBytes", downloadedBytes.toDouble())
        result.putDouble("totalBytes", totalBytes.toDouble())
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

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !reactContext.packageManager.canRequestPackageInstalls()
            ) {
                lastError = "请允许 MusicFree 安装未知应用后重试"
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(settingsIntent)
                emitEvent("permission", lastError)
                return
            }

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

    private fun unregisterInstallReceiver() {
        if (!installReceiverRegistered) return
        try {
            reactContext.unregisterReceiver(installResultReceiver)
        } catch (_: Exception) {
        } finally {
            installReceiverRegistered = false
        }
    }

    @ReactMethod
    fun cancelDownload(promise: Promise) {
        val wasDownloading = isDownloading
        cancelActiveDownload()
        downloadFinishedVerified = false
        currentSpeedBps = 0L
        promise.resolve(wasDownloading)
    }

    override fun invalidate() {
        cancelActiveDownload()
        unregisterInstallReceiver()
        super.invalidate()
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