package `fun`.upup.musicfree.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
 * APK 下载并自动安装模块
 *
 * 流程：
 * 1. downloadApk(url) — 使用 DownloadManager 下载 APK
 * 2. 下载完成后自动弹出安装界面
 * 3. JS 层可通过事件监听下载进度
 */
class ApkUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ApkUpdate"
        private const val APK_FILE_NAME = "MusicFree-update.apk"
        private const val EVENT_NAME = "apkUpdateProgress"
    }

    private var downloadId: Long = -1
    private var downloadReceiverRegistered = false

    private val downloadCompleteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) ?: -1
            if (id == downloadId && downloadId != -1L) {
                Log.d(TAG, "下载完成, downloadId=$id")
                installApk()
                // 清理注册
                try {
                    reactContext.unregisterReceiver(this)
                    downloadReceiverRegistered = false
                } catch (e: Exception) {
                    // ignore
                }
            }
        }
    }

    override fun getName(): String = "ApkUpdate"

    /**
     * 下载 APK 并自动安装
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
     * 安装 APK（自动弹出安装界面）
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

            Log.d(TAG, "准备安装 APK: ${apkFile.absolutePath}, 大小=${apkFile.length()}")

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
            Log.d(TAG, "已启动安装界面")
            emitEvent("installing", "")
        } catch (e: Exception) {
            Log.e(TAG, "安装失败", e)
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
