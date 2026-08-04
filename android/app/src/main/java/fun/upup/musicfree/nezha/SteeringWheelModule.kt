package `fun`.upup.musicfree.nezha

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * 哪吒车机方向盘按键适配模块
 *
 * 支持的广播 Action（哪吒不同车型/固件可能使用不同的 Action）：
 * - hozon.intent.action.SWC_MEDIA_KEY       (主流)
 * - hozon.intent.action.SWC_KEY             (部分车型)
 * - android.intent.action.MEDIA_BUTTON      (标准 Android 媒体按键)
 *
 * 支持的 extra key（不同固件传递 keyCode 的字段名不同）：
 * - KeyEvent.keyCode
 * - keyCode
 * - KEY_CODE
 * - extra_keycode
 *
 * 支持的按键功能：
 * - 上一首 / 下一首 / 播放 / 暂停 / 播放暂停切换
 * - 音量+ / 音量-
 */
class SteeringWheelModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private val ACTIONS = listOf(
            "hozon.intent.action.SWC_MEDIA_KEY",
            "hozon.intent.action.SWC_KEY",
            "android.intent.action.MEDIA_BUTTON",
        )

        private val EXTRA_KEYS = listOf(
            "KeyEvent.keyCode",
            "keyCode",
            "KEY_CODE",
            "extra_keycode",
        )

        private const val EVENT_NAME = "steeringWheelMediaKey"
    }

    private var receiverRegistered = false

    private val swcReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return

            // 尝试多种 extra key 获取按键码
            val keyCode = parseKeyCode(intent)
            if (keyCode != KeyEvent.KEYCODE_UNKNOWN) {
                // 音量键在原生层直接处理，确保响应及时
                when (keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP -> {
                        adjustVolumeNative(1)
                    }
                    KeyEvent.KEYCODE_VOLUME_DOWN -> {
                        adjustVolumeNative(-1)
                    }
                    10004 -> adjustVolumeNative(1)
                    10005 -> adjustVolumeNative(-1)
                }
                // 仍然通知 JS 层（用于同步状态等）
                notifyMediaKey(keyCode)
            }
        }
    }

    override fun getName(): String = "SteeringWheel"

    /**
     * 启动方向盘按键监听（注册所有可能的 Action）
     */
    @ReactMethod
    fun startListening(promise: Promise) {
        try {
            if (receiverRegistered) {
                promise.resolve(true)
                return
            }

            val filter = IntentFilter().apply {
                for (action in ACTIONS) {
                    addAction(action)
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(swcReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                reactContext.registerReceiver(swcReceiver, filter)
            }
            receiverRegistered = true
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * 停止方向盘按键监听
     */
    @ReactMethod
    fun stopListening(promise: Promise) {
        try {
            if (!receiverRegistered) {
                promise.resolve(true)
                return
            }
            reactContext.unregisterReceiver(swcReceiver)
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
     * 调整系统音量（音乐流）
     * @param delta 正数增加，负数减少
     */
    @ReactMethod
    fun adjustMusicVolume(delta: Int, promise: Promise) {
        try {
            val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val streamType = AudioManager.STREAM_MUSIC
            val current = audioManager.getStreamVolume(streamType)
            val max = audioManager.getStreamMaxVolume(streamType)
            val newVolume = (current + delta).coerceIn(0, max)
            audioManager.setStreamVolume(streamType, newVolume, 0)
            promise.resolve(newVolume)
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    /**
     * 获取当前音乐流音量
     */
    @ReactMethod
    fun getMusicVolume(promise: Promise) {
        try {
            val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            promise.resolve(audioManager.getStreamVolume(AudioManager.STREAM_MUSIC))
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        }
    }

    /**
     * 尝试从多个 extra key 中解析按键码
     */
    private fun parseKeyCode(intent: Intent): Int {
        for (key in EXTRA_KEYS) {
            val value = intent.getIntExtra(key, KeyEvent.KEYCODE_UNKNOWN)
            if (value != KeyEvent.KEYCODE_UNKNOWN) {
                return value
            }
        }
        return KeyEvent.KEYCODE_UNKNOWN
    }

    /**
     * 原生层直接调整音乐流音量
     */
    private fun adjustVolumeNative(delta: Int) {
        try {
            val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val streamType = AudioManager.STREAM_MUSIC
            val current = audioManager.getStreamVolume(streamType)
            val max = audioManager.getStreamMaxVolume(streamType)
            val newVolume = (current + delta).coerceIn(0, max)
            audioManager.setStreamVolume(streamType, newVolume, 0)
        } catch (e: Exception) {
            // ignore
        }
    }

    /**
     * 将按键事件转发到 JS 层
     */
    private fun notifyMediaKey(keyCode: Int) {
        try {
            val params = Arguments.createMap()
            params.putInt("keyCode", keyCode)

            val action = when (keyCode) {
                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
                KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playPause"
                KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
                KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
                KeyEvent.KEYCODE_VOLUME_UP -> "volumeUp"
                KeyEvent.KEYCODE_VOLUME_DOWN -> "volumeDown"
                // 部分车机使用自定义按键码
                10001 -> "previous"   // 哪吒自定义上一曲
                10002 -> "next"       // 哪吒自定义下一曲
                10003 -> "playPause"  // 哪吒自定义播放暂停
                10004 -> "volumeUp"   // 哪吒自定义音量+
                10005 -> "volumeDown" // 哪吒自定义音量-
                else -> {
                    // 未知按键也转发，方便调试
                    "unknown_$keyCode"
                }
            }
            params.putString("action", action)

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_NAME, params)
        } catch (e: Exception) {
            // 忽略发送失败
        }
    }
}
