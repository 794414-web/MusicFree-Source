# Add project specific ProGuard rules here.

# --- React Native ---
-keep,allowobfuscation,allowshrinking class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.modules.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keepclassmembers class * { @com.facebook.react.bridge.* <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.* <methods>; }

# --- Hermes ---
-keep class com.facebook.hermes.** { *; }

# --- Expo ---
-keep class expo.modules.** { *; }
-keep class * implements expo.modules.core.interfaces.* { *; }
-keepclassmembers class * { @expo.modules.core.interfaces.* <methods>; }

# --- OkHttp ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# --- Kotlin Coroutines ---
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

# --- AndroidX ---
-keep class androidx.core.** { *; }
-keep class androidx.appcompat.** { *; }
-keep class androidx.fileprovider.** { *; }
-keep class androidx.core.content.FileProvider { *; }

# --- 应用原生模块 ---
-keep class fun.upup.musicfree.** { *; }
-keepclassmembers class fun.upup.musicfree.** { *; }

# --- 第三方库 ---
-keep class net.jthink.jaudiotagger.** { *; }
-keep class com.facebook.fresco.** { *; }

# --- RN 第三方模块 ---
-keep class com.doublesymmetry.** { *; }
-keep class com.swmansion.** { *; }
-keep class org.reactnative.** { *; }
-keep class com.rnfs.** { *; }
-keep class com.reactnativecommunity.** { *; }
-keep class com.learnium.RNDeviceInfo { *; }
-keep class com.brentvatne.** { *; }
-keep class com.projectseattle.RNViewShot { *; }

# --- 保留 NativeModule 反射调用 ---
-keep class * extends com.facebook.react.bridge.ReactContextBaseJavaModule { *; }
-keep class * implements com.facebook.react.bridge.NativeModule { *; }

# --- 保留 Parcelable ---
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# --- 保留 R 文件 ---
-keep class **.R { *; }
-keep class **.R$* { *; }
