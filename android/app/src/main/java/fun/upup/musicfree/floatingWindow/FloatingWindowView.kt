package `fun`.upup.musicfree.floatingWindow

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.DisplayMetrics
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
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * MusicFree 悬浮窗视图
 *
 * 功能：
 * - 顶部区域可拖动整个窗口
 * - 右下角可调整窗口大小
 * - 显示上一曲 / 播放暂停 / 下一曲 三个按钮
 * - 显示当前歌词文本
 *
 * 按钮点击通过 RCTDeviceEventEmitter 上抛到 JS 层。
 */
class FloatingWindowView(private val reactContext: ReactContext) : FrameLayout(reactContext) {

    private var windowManager: WindowManager? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    // 封面图
    private val coverImage: ImageView = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        visibility = View.GONE
        setBackgroundColor(Color.TRANSPARENT)
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
        // textSize 默认按 SP 单位解释，无需手动转换
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

    init {
        // 初始化控制栏按钮
        prevBtn.setImageResource(android.R.drawable.ic_media_previous)
        playPauseBtn.setImageResource(android.R.drawable.ic_media_play)
        nextBtn.setImageResource(android.R.drawable.ic_media_next)

        // 设置默认按钮图标颜色（与默认文字颜色一致）
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

        // 添加封面（默认隐藏）
        rootLayout.addView(
            coverImage,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(140f).toInt()
            ).apply {
                bottomMargin = dpToPx(8f).toInt()
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
     */
    fun show(initialWidth: Int, initialHeight: Int) {
        if (windowManager != null) return

        try {
            windowManager =
                reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager

            // 获取真实屏幕尺寸（包含状态栏/导航栏区域）
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
                x = (screenWidth - currentWidth) / 2
                y = screenHeight / 4
            }

            windowManager?.addView(this, layoutParams)

            // 绑定触摸监听：处理拖动 + 缩放
            setOnTouchListener(CombinedTouchListener())
        } catch (e: Exception) {
            hide()
            throw e
        }
    }

    /**
     * 隐藏悬浮窗
     */
    fun hide() {
        try {
            if (windowManager != null && parent != null) {
                windowManager?.removeView(this)
            }
        } catch (e: Exception) {
            // ignore
        }
        windowManager = null
        layoutParams = null
    }

    /**
     * 更新歌词
     */
    fun setLyric(text: String?) {
        post {
            lyricText.text = text ?: ""
        }
    }

    /**
     * 更新播放状态
     */
    fun setIsPlaying(playing: Boolean) {
        isPlaying = playing
        post {
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
        val lp = layoutParams ?: return
        currentWidth = width.coerceAtLeast(dpToPx(200f).toInt())
        currentHeight = if (height > 0) height else WindowManager.LayoutParams.WRAP_CONTENT
        lp.width = currentWidth
        lp.height = currentHeight
        try {
            windowManager?.updateViewLayout(this, lp)
        } catch (e: Exception) {
            // ignore
        }
    }

    /**
     * 调整字号
     */
    fun setFontSize(sp: Float) {
        post {
            lyricText.textSize = sp
        }
    }

    /**
     * 设置主题颜色（背景、文字、按钮图标）
     */
    fun setThemeColors(backgroundColor: String?, textColor: String?) {
        post {
            val textColorInt = try {
                Color.parseColor(rgba2argb(textColor ?: "#FFE9D2"))
            } catch (e: Exception) {
                Color.parseColor("#FFE9D2")
            }

            try {
                (rootLayout.background as? GradientDrawable)?.setColor(
                    Color.parseColor(rgba2argb(backgroundColor ?: "#CC000000"))
                )
            } catch (e: Exception) {
                // ignore
            }

            try {
                lyricText.setTextColor(textColorInt)
            } catch (e: Exception) {
                // ignore
            }

            // 同步按钮图标颜色
            try {
                val tintList = ColorStateList.valueOf(textColorInt)
                prevBtn.imageTintList = tintList
                playPauseBtn.imageTintList = tintList
                nextBtn.imageTintList = tintList
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    /**
     * 设置封面图片
     * @param url 图片 URL 或本地路径
     */
    fun setCover(url: String?) {
        if (url.isNullOrEmpty()) {
            post {
                coverImage.setImageDrawable(null)
                coverImage.visibility = View.GONE
            }
            return
        }

        // 异步加载图片
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val bitmap = loadBitmap(url)
                withContext(Dispatchers.Main) {
                    if (bitmap != null) {
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
        post {
            coverImage.visibility = if (visible) View.VISIBLE else View.GONE
        }
    }

    /**
     * 从 URL 或本地路径加载 Bitmap
     */
    private fun loadBitmap(path: String): android.graphics.Bitmap? {
        return try {
            if (path.startsWith("http://") || path.startsWith("https://")) {
                // 网络图片
                val url = URL(path)
                val connection = url.openConnection() as HttpURLConnection
                connection.doInput = true
                connection.connect()
                val input = connection.inputStream
                BitmapFactory.decodeStream(input)
            } else {
                // 本地文件
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
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("FloatingWindowAction", action)
        } catch (e: Exception) {
            // ignore
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
     * - 右下角 24dp 区域为缩放手柄
     * - 其它区域为拖动
     */
    private inner class CombinedTouchListener : OnTouchListener {
        override fun onTouch(v: View, event: MotionEvent): Boolean {
            val lp = layoutParams ?: return false
            val resizeHandle = dpToPx(28f)

            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = lp.x
                    initialY = lp.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY

                    // 检查是否点击在右下角缩放区
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
                    if (isResizing) {
                        // 调整大小
                        val dx = (event.rawX - resizeInitialX).toInt()
                        val dy = (event.rawY - resizeInitialY).toInt()
                        val newW = (resizeInitialW + dx)
                            .coerceAtLeast(dpToPx(200f).toInt())
                            .coerceAtMost(screenWidth)
                        val newH = if (resizeInitialH > 0) {
                            (resizeInitialH + dy)
                                .coerceAtLeast(dpToPx(80f).toInt())
                                .coerceAtMost(screenHeight)
                        } else {
                            WindowManager.LayoutParams.WRAP_CONTENT
                        }
                        setSize(newW, newH)
                    } else {
                        // 拖动
                        lp.x = (initialX + (event.rawX - initialTouchX).toInt())
                            .coerceIn(0, (screenWidth - lp.width).coerceAtLeast(0))
                        lp.y = (initialY + (event.rawY - initialTouchY).toInt())
                            .coerceIn(0, (screenHeight - lp.height).coerceAtLeast(0))
                        try {
                            windowManager?.updateViewLayout(this@FloatingWindowView, lp)
                        } catch (e: Exception) {
                            // ignore
                        }
                    }
                    return true
                }

                MotionEvent.ACTION_UP -> {
                    isResizing = false
                    return true
                }
            }
            return false
        }
    }
}
