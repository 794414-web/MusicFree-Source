package `fun`.upup.musicfree.nezha

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * 车机全屏通知控制模块
 *
 * 监听车机系统广播，根据 FULLSCREEN_ON / FULLSCREEN_OFF 信号
 * 控制应用的全屏显示状态（例如音乐播放时的全屏封面通知）。
 *
 * 支持的广播 Action：
 * - io.github.netamade.FULLSCREEN_ON   (请求进入全屏模式)
 * - io.github.netamade.FULLSCREEN_OFF  (请求退出全屏模式)
 */
class FullscreenNotificationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "FullscreenNotif"

        private const val ACTION_FULLSCREEN_ON = "io.github.netamade.FULLSCREEN_ON"
        private const val ACTION_FULLSCREEN_OFF = "io.github.netamade.FULLSCREEN_OFF"

        private const val EVENT_FULLSCREEN_STATE = "fullscreenStateChanged"
    }

    private var receiverRegistered = false
    private var lastState: String = "off"

    private val fullscreenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            Log.d(TAG, "收到广播: action=$action")

            when (action) {
                ACTION_FULLSCREEN_ON -> {
                    lastState = "on"
                    Log.d(TAG, "进入全屏模式")
                    notifyFullscreenState("on")
                }
                ACTION_FULLSCREEN_OFF -> {
                    lastState = "off"
                    Log.d(TAG, "退出全屏模式")
                    notifyFullscreenState("off")
                }
                else -> {
                    Log.w(TAG, "未知 action: $action")
                }
            }
        }
    }

    override fun getName(): String = "FullscreenNotification"

    /**
     * 启动全屏通知监听
     */
    @ReactMethod
    fun startListening(promise: Promise) {
        try {
            if (receiverRegistered) {
                Log.d(TAG, "广播接收器已注册，跳过")
                promise.resolve(true)
                return
            }

            val filter = IntentFilter().apply {
                addAction(ACTION_FULLSCREEN_ON)
                addAction(ACTION_FULLSCREEN_OFF)
                Log.d(TAG, "注册监听: $ACTION_FULLSCREEN_ON, $ACTION_FULLSCREEN_OFF")
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(fullscreenReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                reactContext.registerReceiver(fullscreenReceiver, filter)
            }
            receiverRegistered = true
            Log.d(TAG, "全屏通知广播接收器注册成功")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "广播接收器注册失败", e)
            promise.resolve(false)
        }
    }

    /**
     * 停止全屏通知监听
     */
    @ReactMethod
    fun stopListening(promise: Promise) {
        try {
            if (!receiverRegistered) {
                promise.resolve(true)
                return
            }
            reactContext.unregisterReceiver(fullscreenReceiver)
            receiverRegistered = false
            Log.d(TAG, "全屏通知广播接收器已注销")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "注销广播接收器失败", e)
            promise.resolve(false)
        }
    }

    /**
     * 获取当前全屏状态
     */
    @ReactMethod
    fun getCurrentState(promise: Promise) {
        promise.resolve(lastState)
    }

    /**
     * 检查设备是否支持此功能
     */
    @ReactMethod
    fun isSupported(promise: Promise) {
        val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        promise.resolve(supported)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    /**
     * 发送全屏状态变化事件到 JS 层
     */
    private fun notifyFullscreenState(state: String) {
        try {
            val params = Arguments.createMap()
            params.putString("state", state)
            params.putString("action", if (state == "on") "enterFullscreen" else "exitFullscreen")

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_FULLSCREEN_STATE, params)
            Log.d(TAG, "已发送全屏状态事件: $state")
        } catch (e: Exception) {
            Log.e(TAG, "发送全屏状态事件失败", e)
        }
    }
}