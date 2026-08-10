package `fun`.upup.musicfree.floatingWindow

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.facebook.react.bridge.*

/**
 * 悬浮窗原生模块：管理权限检查、显示、隐藏、状态更新
 *
 * 优化点：
 * - 使用 Application Context 避免 Activity 泄漏
 * - 单例模式：不同类型的悬浮窗只保留一个实例
 * - hide 只隐藏不销毁，show 时直接显示已有实例
 * - destroy 彻底清理，不影响下次重新创建
 * - 所有 UI 操作通过主线程 Handler
 */
class FloatingWindowModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FloatingWindow"

    companion object {
        private const val TAG = "FloatingWindowModule"

        @Volatile
        private var instance: FloatingWindowView? = null

        @Volatile
        private var isVisible: Boolean = false

        private val mainHandler = Handler(Looper.getMainLooper())

        /**
         * 获取单例实例（线程安全）
         */
        fun getInstance(context: Context): FloatingWindowView {
            return instance ?: synchronized(this) {
                instance ?: FloatingWindowView(context.applicationContext as Application).also {
                    instance = it
                }
            }
        }

        /**
         * 彻底销毁悬浮窗
         */
        fun destroyInstance() {
            mainHandler.post {
                try {
                    instance?.let { view ->
                        view.destroy()
                    }
                } catch (_: Exception) {}
                instance = null
                isVisible = false
            }
        }
    }

    private val appContext: Context by lazy {
        reactContext.applicationContext
    }

    @ReactMethod
    fun checkPermission(promise: Promise) {
        try {
            promise.resolve(Settings.canDrawOverlays(reactContext))
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
    }

    @ReactMethod
    fun requestPermission(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                data = Uri.parse("package:" + reactContext.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.currentActivity?.startActivity(intent)
                ?: run {
                    reactContext.startActivity(intent)
                }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
    }

    @ReactMethod
    fun show(initialWidth: Int, initialHeight: Int, promise: Promise) {
        try {
            if (!Settings.canDrawOverlays(reactContext)) {
                promise.reject("NO_PERMISSION", "未授予悬浮窗权限")
                return
            }

            mainHandler.post {
                try {
                    val view = getInstance(appContext)
                    view.show(initialWidth, initialHeight)
                    isVisible = true
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("Exception", e.message)
                }
            }
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun hide(promise: Promise) {
        try {
            mainHandler.post {
                try {
                    instance?.hide()
                    isVisible = false
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("Exception", e.message)
                }
            }
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        try {
            destroyInstance()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun isVisible(promise: Promise) {
        try {
            promise.resolve(isVisible)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setLyric(text: String, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setLyric(text)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setIsPlaying(playing: Boolean, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setIsPlaying(playing)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setSize(width: Int, height: Int, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setSize(width, height)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setFontSize(sp: Double, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setFontSize(sp.toFloat())
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setThemeColors(backgroundColor: String?, textColor: String?, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setThemeColors(backgroundColor, textColor)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setCover(url: String?, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setCover(url)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setCoverVisible(visible: Boolean, promise: Promise) {
        try {
            mainHandler.post {
                instance?.setCoverVisible(visible)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter API, no-op
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter API, no-op
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        // RN 实例销毁时不清理悬浮窗（因为使用 Application Context）
        // 悬浮窗应该持续存在直到用户主动关闭或应用被杀
    }
}