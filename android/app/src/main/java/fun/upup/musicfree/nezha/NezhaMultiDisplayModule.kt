package `fun`.upup.musicfree.nezha

import android.content.Context
import android.hardware.display.DisplayManager
import android.view.Display
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * 哪吒车机多屏适配模块
 *
 * 功能：
 * 1. 检测系统配置的屏幕能力（副驾屏 ro.hozon.car.psd，HUD ro.hozon.car.arhud）
 * 2. 枚举当前可用的 Display 列表
 * 3. 提供 displayId 信息供悬浮窗模块使用
 *
 * 注意：displayId 是运行时值，不能写死为固定 ID
 */
class NezhaMultiDisplayModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val PROP_VICE_DISPLAY = "ro.hozon.car.psd"
        private const val PROP_HUD_DISPLAY = "ro.hozon.car.arhud"
    }

    override fun getName(): String = "NezhaMultiDisplay"

    /**
     * 获取当前所有可用屏幕信息
     * 返回数组，每项包含: { displayId, name, width, height, isDefault, role }
     * role 可选值: "main", "vice", "hud", "unknown"
     */
    @ReactMethod
    fun getDisplays(promise: Promise) {
        try {
            val displayManager = reactContext.getSystemService(Context.DISPLAY_SERVICE)
                as? DisplayManager
            val displays = displayManager?.displays ?: emptyArray<Display>()

            val hasVice = hasViceDisplay()
            val hasHud = hasHudDisplay()

            val result: WritableArray = Arguments.createArray()

            // 先处理 HUD（如果只有 HUD，它是第一个次屏）
            // 再处理副驾屏
            // 最后处理其他未知次屏
            val secondaryDisplays = displays.filter { it.displayId != Display.DEFAULT_DISPLAY }

            for (display in displays) {
                val map: WritableMap = Arguments.createMap()
                map.putInt("displayId", display.displayId)
                map.putString("name", display.name ?: "")
                map.putInt("width", display.width)
                map.putInt("height", display.height)
                map.putBoolean("isDefault", display.displayId == Display.DEFAULT_DISPLAY)

                // 判断角色
                val role = if (display.displayId == Display.DEFAULT_DISPLAY) {
                    "main"
                } else if (hasHud && !hasVice) {
                    // 只有 HUD，次屏就是 HUD
                    "hud"
                } else if (hasVice && !hasHud) {
                    // 只有副驾屏，次屏就是副驾屏
                    "vice"
                } else if (hasHud && hasVice) {
                    // 两者都有，第一个次屏优先归为 HUD，第二个归为副驾屏
                    if (display.displayId == secondaryDisplays.firstOrNull()?.displayId) {
                        "hud"
                    } else {
                        "vice"
                    }
                } else {
                    "unknown"
                }
                map.putString("role", role)
                result.pushMap(map)
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.resolve(Arguments.createArray())
        }
    }

    /**
     * 获取副驾屏 displayId，不存在返回 -1
     */
    @ReactMethod
    fun getViceDisplayId(promise: Promise) {
        try {
            if (!hasViceDisplay()) {
                promise.resolve(-1)
                return
            }
            val displayId = findSecondaryDisplayId()
            promise.resolve(displayId)
        } catch (e: Exception) {
            promise.resolve(-1)
        }
    }

    /**
     * 获取 HUD displayId，不存在返回 -1
     */
    @ReactMethod
    fun getHudDisplayId(promise: Promise) {
        try {
            if (!hasHudDisplay()) {
                promise.resolve(-1)
                return
            }
            val displayId = findSecondaryDisplayId()
            promise.resolve(displayId)
        } catch (e: Exception) {
            promise.resolve(-1)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    /**
     * 查找第一个次屏的 displayId
     */
    private fun findSecondaryDisplayId(): Int {
        val displayManager = reactContext.getSystemService(Context.DISPLAY_SERVICE)
            as? DisplayManager ?: return -1
        val displays = displayManager.displays ?: return -1
        val secondary = displays.firstOrNull { it.displayId != Display.DEFAULT_DISPLAY }
        return secondary?.displayId ?: -1
    }

    /**
     * 读取系统属性判断是否配置了副驾屏
     */
    private fun hasViceDisplay(): Boolean {
        return readSystemPropertyInt(PROP_VICE_DISPLAY, 0) == 1
    }

    /**
     * 读取系统属性判断是否配置了 HUD
     */
    private fun hasHudDisplay(): Boolean {
        return readSystemProperty(PROP_HUD_DISPLAY, "0") == "1"
    }

    private fun readSystemProperty(key: String, defaultValue: String): String {
        return try {
            val clazz = Class.forName("android.os.SystemProperties")
            val method = clazz.getMethod("get", String::class.java, String::class.java)
            method.invoke(null, key, defaultValue) as? String ?: defaultValue
        } catch (e: Exception) {
            defaultValue
        }
    }

    private fun readSystemPropertyInt(key: String, defaultValue: Int): Int {
        return try {
            Integer.parseInt(readSystemProperty(key, defaultValue.toString()))
        } catch (e: Exception) {
            defaultValue
        }
    }
}
