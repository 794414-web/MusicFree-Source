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
 * 支持功能：
 * 1. 监听车机 FULLSCREEN_ON / FULLSCREEN_OFF 广播，控制应用全屏显示状态
 * 2. 监听系统 SCREEN_OFF / SCREEN_ON 广播，实现息屏自动暂停播放
 *
 * 支持的广播 Action：
 * - io.github.netamade.FULLSCREEN_ON   (请求进入全屏模式)
 * - io.github.netamade.FULLSCREEN_OFF  (请求退出全屏模式)
 * - android.intent.action.SCREEN_OFF  (屏幕关闭/息屏)
 * - android.intent.action.SCREEN_ON   (屏幕开启/亮屏)
 */
class FullscreenNotificationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "FullscreenNotif"

        private const val ACTION_FULLSCREEN_ON = "io.github.netamade.FULLSCREEN_ON"
        private const val ACTION_FULLSCREEN_OFF = "io.github.netamade.FULLSCREEN_OFF"
        private const val ACTION_SCREEN_OFF = Intent.ACTION_SCREEN_OFF
        private const val ACTION_SCREEN_ON = Intent.ACTION_SCREEN_ON

        private const val EVENT_FULLSCREEN_STATE = "fullscreenStateChanged"
        private const val EVENT_SCREEN_STATE = "screenStateChanged"
    }

    private var receiverRegistered = false
    private var lastFullscreenState: String = "off"
    private var lastScreenState: String = "on"

    /**
     * 广播接收器，同时处理全屏通知和屏幕状态变化
     */
    private val combinedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            Log.d(TAG, "收到广播: action=$action")

            when (action) {
                ACTION_FULLSCREEN_ON -> {
                    lastFullscreenState = "on"
                    Log.d(TAG, "进入全屏模式")
                    notifyFullscreenState("on")
                }
                ACTION_FULLSCREEN_OFF -> {
                    lastFullscreenState = "off"
                    Log.d(TAG, "退出全屏模式")
                    notifyFullscreenState("off")
                }
                ACTION_SCREEN_OFF -> {
                    lastScreenState = "off"
                    Log.d(TAG, "屏幕关闭 (息屏)")
                    notifyScreenState("off")
                }
                ACTION_SCREEN_ON -> {
                    lastScreenState = "on"
                    Log.d(TAG, "屏幕开启 (亮屏)")
                    notifyScreenState("on")
                }
                else -> {
                    Log.w(TAG, "未知 action: $action")
                }
            }
        }
    }

    override fun getName(): String = "FullscreenNotification"

    /**
     * 启动全屏通知和屏幕状态监听
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
                addAction(ACTION_SCREEN_OFF)
                addAction(ACTION_SCREEN_ON)
                Log.d(TAG, "注册监听: $ACTION_FULLSCREEN_ON, $ACTION_FULLSCREEN_OFF, $ACTION_SCREEN_OFF, $ACTION_SCREEN_ON")
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(combinedReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                reactContext.registerReceiver(combinedReceiver, filter)
            }
            receiverRegistered = true
            Log.d(TAG, "广播接收器注册成功")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "广播接收器注册失败", e)
            promise.resolve(false)
        }
    }

    /**
     * 停止全屏通知和屏幕状态监听
     */
    @ReactMethod
    fun stopListening(promise: Promise) {
        try {
            if (!receiverRegistered) {
                promise.resolve(true)
                return
            }
            reactContext.unregisterReceiver(combinedReceiver)
            receiverRegistered = false
            Log.d(TAG, "广播接收器已注销")
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
        promise.resolve(lastFullscreenState)
    }

    /**
     * 获取当前屏幕状态
     */
    @ReactMethod
    fun getScreenState(promise: Promise) {
        promise.resolve(lastScreenState)
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

    /**
     * 发送屏幕状态变化事件到 JS 层
     */
    private fun notifyScreenState(state: String) {
        try {
            val params = Arguments.createMap()
            params.putString("state", state)
            params.putString("action", if (state == "on") "screenOn" else "screenOff")

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_SCREEN_STATE, params)
            Log.d(TAG, "已发送屏幕状态事件: $state")
        } catch (e: Exception) {
            Log.e(TAG, "发送屏幕状态事件失败", e)
        }
    }
}