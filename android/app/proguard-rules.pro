# Add project specific ProGuard rules here.

# --- React Native Core (禁止混淆和缩减) ---
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }

# --- React Native Bridge ---
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.modules.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.facebook.react.animated.** { *; }
-keep class com.facebook.react.common.** { *; }
-keep class com.facebook.react.config.** { *; }
-keep class com.facebook.react.devsupport.** { *; }
-keep class com.facebook.react.jscexecutor.** { *; }
-keep class com.facebook.react.bridge.CatalystInstance { *; }
-keep class com.facebook.react.bridge.JavaScriptModule { *; }
-keep class com.facebook.react.bridge.NativeModule { *; }
-keep class com.facebook.react.bridge.ReactApplicationContext { *; }
-keep class com.facebook.react.bridge.ReactContextBaseJavaModule { *; }
-keep class com.facebook.react.bridge.ReadableNativeMap { *; }
-keep class com.facebook.react.bridge.WritableNativeMap { *; }
-keep class com.facebook.react.bridge.ReadableNativeArray { *; }
-keep class com.facebook.react.bridge.WritableNativeArray { *; }
-keep class com.facebook.react.bridge.Arguments { *; }
-keep class com.facebook.react.bridge.Promise { *; }
-keep class com.facebook.react.bridge.ReactMethod { *; }

# 保留所有 @ReactMethod 注解的方法 (关键!)
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# --- 保留所有 NativeModule 类及其成员 ---
-keep class * extends com.facebook.react.bridge.ReactContextBaseJavaModule { *; }
-keep class * implements com.facebook.react.bridge.NativeModule { *; }

# --- React Native 反射调用相关 ---
-keepclassmembers class com.facebook.react.bridge.JavaScriptModule { *; }
-keepclassmembers class com.facebook.react.bridge.NativeModule { *; }

# --- Expo Modules ---
-keep class expo.modules.** { *; }
-keep class expo.** { *; }
-keep class * implements expo.modules.core.interfaces.* { *; }
-keepclassmembers class * {
    @expo.modules.core.interfaces.* *;
}

# --- OkHttp ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# --- Kotlin Coroutines ---
-keep class kotlinx.coroutines.** { *; }
-keep class kotlin.Metadata { *; }
-dontwarn kotlinx.coroutines.**

# --- AndroidX ---
-keep class androidx.core.** { *; }
-keep class androidx.appcompat.** { *; }
-keep class androidx.fileprovider.** { *; }
-keep class androidx.core.content.FileProvider { *; }

# --- 应用原生模块 (完整保留!) ---
-keep class fun.upup.musicfree.** { *; }
-keepclassmembers class fun.upup.musicfree.** { *; }

# --- 第三方库 ---
-keep class net.jthink.jaudiotagger.** { *; }
-dontwarn net.jthink.jaudiotagger.**
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn javax.sound.**
-keep class com.facebook.fresco.** { *; }
-keep class com.doublesymmetry.** { *; }
-keep class com.swmansion.** { *; }
-keep class org.reactnative.** { *; }
-keep class com.rnfs.** { *; }
-keep class com.reactnativecommunity.** { *; }
-keep class com.learnium.RNDeviceInfo { *; }
-keep class com.brentvatne.** { *; }
-keep class com.projectseattle.RNViewShot { *; }
-keep class com.asterinet.react.tcpsocket.** { *; }
-keep class com.shopify.reactnative.flash_list.** { *; }

# --- React Native Third Party Modules ---
-keep class com.reactnativepermissions.** { *; }
-keep class com.artstack.** { *; }

# --- 系统组件 ---
-keep class android.content.** { *; }
-keep class android.net.** { *; }
-keep class android.os.** { *; }
-keep class android.database.** { *; }
-keep class android.app.DownloadManager { *; }
-keep class android.content.pm.PackageInstaller { *; }
-keep class androidx.core.content.FileProvider { *; }

# --- 保留 Parcelable ---
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# --- 保留 R 文件 ---
-keep class **.R { *; }
-keep class **.R$* { *; }

# --- 保留反射相关 ---
-keepclassmembers class * {
    <init>(...);
    <methods>;
}

# --- 保留 JS Module 映射 ---
-keep class com.facebook.react.modules.core.DeviceEventManagerModule { *; }
-keep class com.facebook.react.modules.core.DeviceEventManagerModule$RCTDeviceEventEmitter { *; }
