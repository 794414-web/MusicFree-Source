package `fun`.upup.musicfree.nezha

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.util.Log
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
        private const val TAG = "SteeringWheel"

        private val ACTIONS = listOf(
            "hozon.intent.action.SWC_MEDIA_KEY",
            "hozon.intent.action.SWC_KEY",
            "android.intent.action.MEDIA_BUTTON",
            "com.hozonauto.swc.MEDIA_KEY",
            "com.hozonauto.swc.KEY",
        )

        /** 哪吒/车机可能使用的 int 型 extra key */
        private val EXTRA_KEYS = listOf(
            "KeyEvent.keyCode",
            "keyCode",
            "KEY_CODE",
            "extra_keycode",
            "key_code",
            "extra",
            "hozon_keycode",
            "swc_keycode",
        )

        private const val EVENT_NAME = "steeringWheelMediaKey"
    }

    private var receiverRegistered = false

    private val swcReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            Log.d(TAG, "收到广播: action=$action, extras=${logExtras(intent)}")

            // 尝试多种方式获取按键码
            val keyCode = parseKeyCode(intent)
            Log.d(TAG, "解析到 keyCode=$keyCode")

            if (keyCode != KeyEvent.KEYCODE_UNKNOWN) {
                // 音量键在原生层直接处理，确保响应及时
                when (keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP -> adjustVolumeNative(1)
                    KeyEvent.KEYCODE_VOLUME_DOWN -> adjustVolumeNative(-1)
                    10004 -> adjustVolumeNative(1)
                    10005 -> adjustVolumeNative(-1)
                }
                // 通知 JS 层
                notifyMediaKey(keyCode)
            } else {
                Log.w(TAG, "无法解析按键码，广播内容: ${logExtras(intent)}")
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
                Log.d(TAG, "广播接收器已注册，跳过")
                promise.resolve(true)
                return
            }

            val filter = IntentFilter().apply {
                for (action in ACTIONS) {
                    addAction(action)
                    Log.d(TAG, "注册监听 action: $action")
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(swcReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                reactContext.registerReceiver(swcReceiver, filter)
            }
            receiverRegistered = true
            Log.d(TAG, "广播接收器注册成功，共 ${ACTIONS.size} 个 action")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "广播接收器注册失败", e)
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
     * 尝试从多个来源解析按键码：
     * 1. Intent.EXTRA_KEY_EVENT（标准 Android MEDIA_BUTTON 方式，包含 KeyEvent 对象）
     * 2. 各种 int 型 extra key（哪吒/车机自定义）
     * 3. String 型 extra key 再转 int
     */
    private fun parseKeyCode(intent: Intent): Int {
        // 1. 标准 Android MEDIA_BUTTON：通过 EXTRA_KEY_EVENT 传递 KeyEvent 对象
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val keyEvent = intent.getParcelableExtra(
                Intent.EXTRA_KEY_EVENT, KeyEvent::class.java
            )
            if (keyEvent != null) {
                Log.d(TAG, "从 EXTRA_KEY_EVENT 获取到 keyCode=${keyEvent.keyCode}")
                return keyEvent.keyCode
            }
        } else {
            @Suppress("DEPRECATION")
            val keyEvent = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
            if (keyEvent != null) {
                Log.d(TAG, "从 EXTRA_KEY_EVENT 获取到 keyCode=${keyEvent.keyCode}")
                return keyEvent.keyCode
            }
        }

        // 2. int 型 extra key
        for (key in EXTRA_KEYS) {
            val value = intent.getIntExtra(key, KeyEvent.KEYCODE_UNKNOWN)
            if (value != KeyEvent.KEYCODE_UNKNOWN) {
                Log.d(TAG, "从 int extra '$key' 获取到 keyCode=$value")
                return value
            }
        }

        // 3. String 型 extra key 再转 int
        for (key in EXTRA_KEYS) {
            val strValue = intent.getStringExtra(key)
            if (!strValue.isNullOrEmpty()) {
                try {
                    val value = strValue.toInt()
                    if (value != KeyEvent.KEYCODE_UNKNOWN) {
                        Log.d(TAG, "从 string extra '$key' 获取到 keyCode=$value")
                        return value
                    }
                } catch (e: NumberFormatException) {
                    // 不是数字，跳过
                }
            }
        }

        return KeyEvent.KEYCODE_UNKNOWN
    }

    /**
     * 打印 Intent 所有 extra（用于调试）
     */
    private fun logExtras(intent: Intent): String {
        val sb = StringBuilder()
        val extras = intent.extras
        if (extras != null) {
            for (key in extras.keySet()) {
                val value = extras.get(key)
                sb.append("$key=$value ")
            }
        }
        return if (sb.isEmpty()) "(无 extras)" else sb.toString().trim()
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
