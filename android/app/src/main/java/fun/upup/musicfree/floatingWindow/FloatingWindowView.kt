package `fun`.upup.musicfree.floatingWindow

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * MusicFree 悬浮窗视图
 *
 * 优化点：
 * - 接收 Application Context，避免 Activity 生命周期影响
 * - show 支持两种模式：首次创建 + 已有实例重新显示
 * - hide 只设置 GONE，保留 View 和状态
 * - destroy 彻底从 WindowManager 移除
 * - 所有 UI 更新通过 Handler 主线程执行
 */
class FloatingWindowView(private val appContext: Application) : FrameLayout(appContext) {

    companion object {
        private const val TAG = "FloatingWindowView"
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var windowManager: WindowManager? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var isAttached = false

    // 封面图
    private val coverImage: ImageView = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_INSIDE
        visibility = View.GONE
        setBackgroundColor(Color.TRANSPARENT)
        adjustViewBounds = true
    }

    // 容器
    private val rootLayout: LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dpToPx(12f)
            setColor(Color.parseColor("#CC000000"))
        }
        setPadding(
            dpToPx(12f).toInt(),
            dpToPx(8f).toInt(),
            dpToPx(12f).toInt(),
            dpToPx(8f).toInt()
        )
    }

    // 歌词文本
    private val lyricText: TextView = TextView(context).apply {
        text = "MusicFree"
        setTextColor(Color.parseColor("#FFE9D2"))
        textSize = 14f
        gravity = Gravity.CENTER
        maxLines = 2
        setLineSpacing(2f, 1f)
        setPadding(0, dpToPx(8f).toInt(), 0, dpToPx(8f).toInt())
    }

    // 控制栏
    private val controlBar: LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
    }

    private val prevBtn: ImageButton = createButton()
    private val playPauseBtn: ImageButton = createButton()
    private val nextBtn: ImageButton = createButton()

    // 当前窗口宽高（px）
    private var currentWidth: Int = dpToPx(280f).toInt()
    private var currentHeight: Int = LinearLayout.LayoutParams.WRAP_CONTENT

    // 拖动相关
    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f

    // 缩放相关
    private var resizeInitialX = 0f
    private var resizeInitialY = 0f
    private var resizeInitialW = 0
    private var resizeInitialH = 0
    private var isResizing = false

    // 是否正在播放
    private var isPlaying = false

    // 屏幕尺寸
    private var screenWidth = 0
    private var screenHeight = 0

    // 保存当前位置用于 hide/show 恢复
    private var savedX = 0
    private var savedY = 0

    init {
        prevBtn.setImageResource(android.R.drawable.ic_media_previous)
        playPauseBtn.setImageResource(android.R.drawable.ic_media_play)
        nextBtn.setImageResource(android.R.drawable.ic_media_next)

        val defaultTextColor = Color.parseColor("#FFE9D2")
        val defaultTintList = ColorStateList.valueOf(defaultTextColor)
        prevBtn.imageTintList = defaultTintList
        playPauseBtn.imageTintList = defaultTintList
        nextBtn.imageTintList = defaultTintList

        prevBtn.setOnClickListener { emitEvent("prev") }
        playPauseBtn.setOnClickListener { emitEvent("toggle") }
        nextBtn.setOnClickListener { emitEvent("next") }

        controlBar.addView(prevBtn, linearParams(0))
        controlBar.addView(playPauseBtn, linearParams(dpToPx(8f).toInt()))
        controlBar.addView(nextBtn, linearParams(dpToPx(8f).toInt()))

        rootLayout.addView(
            coverImage,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(8f).toInt()
                gravity = Gravity.CENTER
            }
        )
        rootLayout.addView(
            lyricText,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )
        rootLayout.addView(
            controlBar,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        addView(rootLayout)
    }

    private fun linearParams(marginLeft: Int): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            dpToPx(48f).toInt(),
            dpToPx(48f).toInt()
        ).apply {
            leftMargin = marginLeft
        }
    }

    private fun createButton(): ImageButton {
        return ImageButton(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            setPadding(0, 0, 0, 0)
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        }
    }

    private fun dpToPx(dp: Float): Float {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp,
            context.resources.displayMetrics
        )
    }

    /**
     * 显示悬浮窗
     * - 首次调用：创建 WindowManager.LayoutParams 并添加到系统
     * - 非首次调用：直接设置 VISIBLE，恢复保存的位置
     */
    fun show(initialWidth: Int, initialHeight: Int) {
        if (isAttached) {
            // 已附加到 WindowManager，直接显示
            this.visibility = View.VISIBLE
            layoutParams?.let { lp ->
                lp.x = savedX
                lp.y = savedY
                try {
                    windowManager?.updateViewLayout(this, lp)
                } catch (_: Exception) {}
            }
            return
        }

        try {
            windowManager =
                appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager

            val outMetrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager?.defaultDisplay?.getRealMetrics(outMetrics)
            screenWidth = outMetrics.widthPixels
            screenHeight = outMetrics.heightPixels

            currentWidth = if (initialWidth > 0) initialWidth else dpToPx(280f).toInt()
            currentHeight =
                if (initialHeight > 0) initialHeight else WindowManager.LayoutParams.WRAP_CONTENT

            layoutParams = WindowManager.LayoutParams().apply {
                type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                else
                    WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

                format = PixelFormat.TRANSLUCENT
                flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                width = currentWidth
                height = currentHeight
                gravity = Gravity.TOP or Gravity.START
                x = if (savedX != 0 || savedY != 0) savedX else (screenWidth - currentWidth) / 2
                y = if (savedX != 0 || savedY != 0) savedY else screenHeight / 4
            }

            windowManager?.addView(this, layoutParams)
            isAttached = true

            setOnTouchListener(CombinedTouchListener())
        } catch (e: Exception) {
            Log.e(TAG, "show 失败", e)
            throw e
        }
    }

    /**
     * 隐藏悬浮窗（保留实例和状态，可快速恢复）
     */
    fun hide() {
        try {
            if (isAttached && layoutParams != null) {
                // 保存当前位置
                savedX = layoutParams!!.x
                savedY = layoutParams!!.y
            }
            // 只设置 GONE，不从 WindowManager 移除
            this.visibility = View.GONE
        } catch (e: Exception) {
            Log.e(TAG, "hide 失败", e)
        }
    }

    /**
     * 彻底销毁悬浮窗（从 WindowManager 移除，清理所有资源）
     */
    fun destroy() {
        try {
            if (isAttached && parent != null) {
                windowManager?.removeView(this)
            }
        } catch (e: Exception) {
            Log.e(TAG, "destroy 失败", e)
        }
        windowManager = null
        layoutParams = null
        isAttached = false
        savedX = 0
        savedY = 0
    }

    /**
     * 更新歌词
     */
    fun setLyric(text: String?) {
        mainHandler.post {
            lyricText.text = text ?: ""
        }
    }

    /**
     * 更新播放状态
     */
    fun setIsPlaying(playing: Boolean) {
        isPlaying = playing
        mainHandler.post {
            playPauseBtn.setImageResource(
                if (playing) android.R.drawable.ic_media_pause
                else android.R.drawable.ic_media_play
            )
        }
    }

    /**
     * 调整大小
     */
    fun setSize(width: Int, height: Int) {
        mainHandler.post {
            val lp = layoutParams ?: return@post
            currentWidth = width.coerceAtLeast(dpToPx(200f).toInt())
            currentHeight = if (height > 0) height else WindowManager.LayoutParams.WRAP_CONTENT
            lp.width = currentWidth
            lp.height = currentHeight
            try {
                windowManager?.updateViewLayout(this, lp)
            } catch (_: Exception) {}
        }
    }

    /**
     * 调整字号
     */
    fun setFontSize(sp: Float) {
        mainHandler.post {
            lyricText.textSize = sp
        }
    }

    /**
     * 设置主题颜色
     */
    fun setThemeColors(backgroundColor: String?, textColor: String?) {
        mainHandler.post {
            val textColorInt = try {
                Color.parseColor(rgba2argb(textColor ?: "#FFE9D2"))
            } catch (e: Exception) {
                Color.parseColor("#FFE9D2")
            }

            try {
                (rootLayout.background as? GradientDrawable)?.setColor(
                    Color.parseColor(rgba2argb(backgroundColor ?: "#CC000000"))
                )
            } catch (_: Exception) {}

            try {
                lyricText.setTextColor(textColorInt)
            } catch (_: Exception) {}

            try {
                val tintList = ColorStateList.valueOf(textColorInt)
                prevBtn.imageTintList = tintList
                playPauseBtn.imageTintList = tintList
                nextBtn.imageTintList = tintList
            } catch (_: Exception) {}
        }
    }

    /**
     * 设置封面图片
     */
    fun setCover(url: String?) {
        if (url.isNullOrEmpty()) {
            mainHandler.post {
                coverImage.setImageDrawable(null)
                coverImage.visibility = View.GONE
            }
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val bitmap = loadBitmap(url)
                withContext(Dispatchers.Main) {
                    if (bitmap != null) {
                        val windowWidth = currentWidth - dpToPx(24f).toInt()
                        val ratio = bitmap.height.toFloat() / bitmap.width.toFloat()
                        val targetHeight = (windowWidth * ratio).toInt()
                        val maxHeight = screenHeight / 2
                        val finalHeight = targetHeight.coerceAtMost(maxHeight)

                        val lp = coverImage.layoutParams as? LinearLayout.LayoutParams
                            ?: LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT
                            )
                        lp.height = finalHeight
                        lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                        coverImage.layoutParams = lp

                        coverImage.setImageBitmap(bitmap)
                        coverImage.visibility = View.VISIBLE
                    } else {
                        coverImage.setImageDrawable(null)
                        coverImage.visibility = View.GONE
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    coverImage.setImageDrawable(null)
                    coverImage.visibility = View.GONE
                }
            }
        }
    }

    /**
     * 设置封面是否可见
     */
    fun setCoverVisible(visible: Boolean) {
        mainHandler.post {
            coverImage.visibility = if (visible) View.VISIBLE else View.GONE
        }
    }

    /**
     * 从 URL 或本地路径加载 Bitmap
     */
    private fun loadBitmap(path: String): android.graphics.Bitmap? {
        return try {
            if (path.startsWith("http://") || path.startsWith("https://")) {
                val url = URL(path)
                val connection = url.openConnection() as HttpURLConnection
                connection.doInput = true
                connection.connect()
                val input = connection.inputStream
                BitmapFactory.decodeStream(input)
            } else {
                BitmapFactory.decodeFile(path)
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 上抛事件到 JS 层
     */
    private fun emitEvent(action: String) {
        try {
            val reactContext = appContext as? com.facebook.react.bridge.ReactApplicationContext
            reactContext?.getJSModule(
                com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java
            )?.emit("FloatingWindowAction", action)
        } catch (e: Exception) {
            // 忽略：ReactContext 可能尚未初始化或已销毁
        }
    }

    private fun rgba2argb(color: String): String {
        return if (color.length == 9) {
            color[0] + color.substring(7, 9) + color.substring(1, 7)
        } else {
            color
        }
    }

    /**
     * 综合 TouchListener：
     * - 右下角 28dp 区域为缩放手柄
     * - 其它区域支持拖动、单击进入软件、双击暂停/播放
     */
    private inner class CombinedTouchListener : OnTouchListener {
        private var lastClickTime: Long = 0
        private var lastClickX: Float = 0f
        private var lastClickY: Float = 0f
        private var moved = false
        private val clickDistanceThreshold = dpToPx(10f)
        private val doubleClickTimeWindow = 300L

        override fun onTouch(v: View, event: MotionEvent): Boolean {
            val lp = layoutParams ?: return false
            val resizeHandle = dpToPx(28f)

            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = lp.x
                    initialY = lp.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    moved = false

                    val viewLocation = IntArray(2)
                    getLocationOnScreen(viewLocation)
                    val localX = event.rawX - viewLocation[0]
                    val localY = event.rawY - viewLocation[1]

                    isResizing = (width - localX <= resizeHandle && height - localY <= resizeHandle)
                    if (isResizing) {
                        resizeInitialX = event.rawX
                        resizeInitialY = event.rawY
                        resizeInitialW = lp.width
                        resizeInitialH = lp.height
                    }
                    return true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - initialTouchX
                    val dy = event.rawY - initialTouchY
                    if (Math.abs(dx) > clickDistanceThreshold || Math.abs(dy) > clickDistanceThreshold) {
                        moved = true
                    }

                    if (isResizing) {
                        val dxMove = (event.rawX - resizeInitialX).toInt()
                        val dyMove = (event.rawY - resizeInitialY).toInt()
                        val newW = (resizeInitialW + dxMove)
                            .coerceAtLeast(dpToPx(200f).toInt())
                            .coerceAtMost(screenWidth)
                        val newH = if (resizeInitialH > 0) {
                            (resizeInitialH + dyMove)
                                .coerceAtLeast(dpToPx(80f).toInt())
                                .coerceAtMost(screenHeight)
                        } else {
                            WindowManager.LayoutParams.WRAP_CONTENT
                        }
                        setSize(newW, newH)
                    } else {
                        lp.x = (initialX + (event.rawX - initialTouchX).toInt())
                            .coerceIn(0, (screenWidth - lp.width).coerceAtLeast(0))
                        lp.y = (initialY + (event.rawY - initialTouchY).toInt())
                            .coerceIn(0, (screenHeight - lp.height).coerceAtLeast(0))
                        savedX = lp.x
                        savedY = lp.y
                        try {
                            windowManager?.updateViewLayout(this@FloatingWindowView, lp)
                        } catch (_: Exception) {}
                    }
                    return true
                }

                MotionEvent.ACTION_UP -> {
                    val wasResizing = isResizing
                    isResizing = false

                    if (!moved && !wasResizing) {
                        val now = System.currentTimeMillis()
                        val dxClick = Math.abs(event.rawX - lastClickX)
                        val dyClick = Math.abs(event.rawY - lastClickY)
                        val timeDiff = now - lastClickTime

                        if (timeDiff <= doubleClickTimeWindow &&
                            dxClick <= clickDistanceThreshold * 2 &&
                            dyClick <= clickDistanceThreshold * 2
                        ) {
                            lastClickTime = 0
                            emitEvent("toggle")
                        } else {
                            lastClickTime = now
                            lastClickX = event.rawX
                            lastClickY = event.rawY
                            postDelayed({
                                if (lastClickTime == now) {
                                    launchApp()
                                }
                            }, doubleClickTimeWindow + 50)
                        }
                    }
                    return true
                }
            }
            return false
        }
    }

    /**
     * 启动主应用（从悬浮窗单击回到 App）
     */
    private fun launchApp() {
        try {
            val launchIntent = appContext.packageManager
                ?.getLaunchIntentForPackage(appContext.packageName)
            launchIntent?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                appContext.startActivity(it)
            }
        } catch (e: Exception) {
            Log.e(TAG, "启动 App 失败", e)
        }
    }
}