package `fun`.upup.musicfree.floatingWindow

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.*

/**
 * 悬浮窗原生模块：管理权限检查、显示、隐藏、状态更新
 *
 * 注意：实际显示的 View 是 FloatingWindowView，
 * 它直接通过 WindowManager 添加到系统层，因此只支持 Android。
 */
class FloatingWindowModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FloatingWindow"

    private var view: FloatingWindowView? = null

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
                    // 没有当前 Activity 时也尝试启动
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

            UiThreadUtil.runOnUiThread {
                try {
                    if (view == null) {
                        view = FloatingWindowView(reactContext)
                    }
                    view?.show(initialWidth, initialHeight)
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
            UiThreadUtil.runOnUiThread {
                view?.hide()
                view = null
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setLyric(text: String, promise: Promise) {
        try {
            UiThreadUtil.runOnUiThread {
                view?.setLyric(text)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setIsPlaying(playing: Boolean, promise: Promise) {
        try {
            UiThreadUtil.runOnUiThread {
                view?.setIsPlaying(playing)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setSize(width: Int, height: Int, promise: Promise) {
        try {
            UiThreadUtil.runOnUiThread {
                view?.setSize(width, height)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setFontSize(sp: Double, promise: Promise) {
        try {
            UiThreadUtil.runOnUiThread {
                view?.setFontSize(sp.toFloat())
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setThemeColors(backgroundColor: String?, textColor: String?, promise: Promise) {
        try {
            UiThreadUtil.runOnUiThread {
                view?.setThemeColors(backgroundColor, textColor)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setCover(url: String?, promise: Promise) {
        try {
            view?.setCover(url)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    @ReactMethod
    fun setCoverVisible(visible: Boolean, promise: Promise) {
        try {
            UiThreadUtil.runOnUiThread {
                view?.setCoverVisible(visible)
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
}
