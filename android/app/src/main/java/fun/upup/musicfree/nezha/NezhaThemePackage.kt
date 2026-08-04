package `fun`.upup.musicfree.nezha

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import android.view.View
import com.facebook.react.uimanager.ReactShadowNode

class NezhaThemePackage : ReactPackage {
    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): MutableList<ViewManager<View, ReactShadowNode<*>>> = mutableListOf()

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): MutableList<NativeModule> = listOf(NezhaThemeModule(reactContext)).toMutableList()
}
