package `fun`.upup.musicfree.nezha

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * 哪吒车机主题跟随模块
 *
 * 功能：
 * 1. 读取哪吒系统 persist.sys.theme_night_mode 和 persist.sys.theme.from.map 属性
 * 2. 监听 com.hozonauto.thememanager.ACTION_HOZON_THEME_CHANGED 广播
 * 3. 主题变化时通过 RCTDeviceEventEmitter 通知 JS 层
 *
 * 兼容：非哪吒设备回退到 Configuration.uiMode
 */
class NezhaThemeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "NezhaTheme"
        private const val NIGHT_MODE_PROPERTY = "persist.sys.theme_night_mode"
        private const val MAP_THEME_PROPERTY = "persist.sys.theme.from.map"
        private const val NIGHT_ON = "night_mode_on"
        private const val NIGHT_OFF = "night_mode_off"
        private const val NIGHT_AUTO = "night_mode_auto"
        private const val ACTION_THEME_CHANGED =
            "com.hozonauto.thememanager.ACTION_HOZON_THEME_CHANGED"
    }

    private var receiverRegistered = false

    private val themeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_THEME_CHANGED) {
                // 广播只作为触发器，重新读取实际状态
                notifyThemeChange()
            }
        }
    }

    override fun getName(): String = "NezhaTheme"

    /**
     * 读取当前是否为夜间模式
     * 返回 "night" 或 "day"
     */
    @ReactMethod
    fun getThemeMode(promise: Promise) {
        try {
            val isNight = isNightMode()
            promise.resolve(if (isNight) "night" else "day")
        } catch (e: Exception) {
            promise.resolve("day")
        }
    }

    /**
     * 启动主题监听
     * 启动时立即读取一次当前状态并通知 JS，然后注册广播
     */
    @ReactMethod
    fun startListening(promise: Promise) {
        try {
            if (receiverRegistered) {
                promise.resolve(true)
                return
            }

            // 启动时主动读取一次
            notifyThemeChange()

            val filter = IntentFilter(ACTION_THEME_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(themeReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                reactContext.registerReceiver(themeReceiver, filter)
            }
            receiverRegistered = true
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * 停止主题监听
     */
    @ReactMethod
    fun stopListening(promise: Promise) {
        try {
            if (!receiverRegistered) {
                promise.resolve(true)
                return
            }
            reactContext.unregisterReceiver(themeReceiver)
            receiverRegistered = false
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    /**
     * 判断当前是否为夜间模式
     */
    private fun isNightMode(): Boolean {
        val configured = readSystemProperty(NIGHT_MODE_PROPERTY, NIGHT_AUTO)
        return when (configured) {
            NIGHT_ON -> true
            NIGHT_OFF -> false
            NIGHT_AUTO -> readSystemProperty(MAP_THEME_PROPERTY, "day_mode") == "night_mode"
            else -> isAndroidNight()
        }
    }

    /**
     * 回退方案：通过 Android Configuration 判断
     */
    private fun isAndroidNight(): Boolean {
        val mask = reactContext.resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK
        return mask == Configuration.UI_MODE_NIGHT_YES
    }

    /**
     * 通过反射读取系统属性（避免编译期依赖隐藏 API）
     */
    private fun readSystemProperty(key: String, defaultValue: String): String {
        return try {
            val clazz = Class.forName("android.os.SystemProperties")
            val method = clazz.getMethod("get", String::class.java, String::class.java)
            method.invoke(null, key, defaultValue) as? String ?: defaultValue
        } catch (e: Exception) {
            defaultValue
        }
    }

    /**
     * 通知 JS 层主题变化
     */
    private fun notifyThemeChange() {
        try {
            val isNight = isNightMode()
            val params = Arguments.createMap()
            params.putString("mode", if (isNight) "night" else "day")
            params.putBoolean("isNight", isNight)
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("nezhaThemeChanged", params)
        } catch (e: Exception) {
            // 忽略发送失败
        }
    }
}
