package `fun`.upup.musicfree

import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.os.Bundle

/**
 * MusicFree MainActivity
 *
 * 适配说明：
 * - 不再强制设置屏幕亮度（之前 BRIGHTNESS_OVERRIDE_FULL 会导致手机/车机屏幕长期最高亮度，
 *   影响功耗与发热，部分车机甚至会出现显示异常）。
 * - 屏幕常亮通过 expo-keep-awake 在 JS 层按需启用，避免一启动就强制常亮。
 * - 返回键保持系统默认行为，避免在车机上误触直接退出。
 */
class MainActivity : ReactActivity() {

    /**
     * 返回主组件名称
     */
    override fun getMainComponentName(): String = "MusicFree"

    /**
     * 创建 React Activity 代理
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate =
        ReactActivityDelegateWrapper(this, false, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))

    /**
     * Activity 创建
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        // 注册启动画面
        SplashScreenManager.registerOnActivity(this)
        super.onCreate(null)
    }
}
