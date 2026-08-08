package `fun`.upup.musicfree.neta

import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URLEncoder

/**
 * NetA 哪吒互联 - 元数据 API 模块
 *
 * 通过 AF_UNIX 抽象命名 socket 访问哪吒互联的元数据服务
 * 获取歌词和封面数据
 *
 * 抽象 socket 名: com.neta.isulewtools.localserver.metadata
 * 协议: HTTP/1.1 (GET 请求, Connection: close 响应)
 */
class NetAMetadataModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "NetAMetadata"
        private const val SOCKET_NAME = "com.neta.isulewtools.localserver.metadata"
        private const val CONNECT_TIMEOUT_MS = 5000
        private const val READ_TIMEOUT_MS = 5000
        private const val MAX_RESPONSE_SIZE = 512 * 1024 // 512KB
    }

    override fun getName(): String = "NetAMetadata"

    /**
     * 健康检查
     */
    @ReactMethod
    fun healthCheck(promise: Promise) {
        try {
            val response = doRequest("/v1/health")
            promise.resolve(parseHealthResponse(response))
        } catch (e: Exception) {
            promise.reject("NETA_UNAVAILABLE", "NetA metadata service unavailable: ${e.message}")
        }
    }

    /**
     * 获取歌词
     * @param title 歌曲标题
     * @param artist 歌手
     */
    @ReactMethod
    fun getLyric(title: String, artist: String, promise: Promise) {
        try {
            val encodedTitle = urlEncode(title)
            val encodedArtist = urlEncode(artist)
            val path = "/v1/lyric?title=$encodedTitle&artist=$encodedArtist"
            val response = doRequest(path)
            promise.resolve(parseLyricResponse(response))
        } catch (e: Exception) {
            promise.reject("LYRIC_FETCH_FAILED", "Failed to fetch lyric: ${e.message}")
        }
    }

    /**
     * 获取封面 URL
     * @param title 歌曲标题
     * @param artist 歌手
     */
    @ReactMethod
    fun getCover(title: String, artist: String, promise: Promise) {
        try {
            val encodedTitle = urlEncode(title)
            val encodedArtist = urlEncode(artist)
            val path = "/v1/cover?title=$encodedTitle&artist=$encodedArtist"
            val response = doRequest(path)
            promise.resolve(parseCoverResponse(response))
        } catch (e: Exception) {
            promise.reject("COVER_FETCH_FAILED", "Failed to fetch cover: ${e.message}")
        }
    }

    /**
     * 批量获取歌词
     * @param requests Array of {title, artist} objects
     */
    @ReactMethod
    fun batchGetLyric(requests: ReadableMap, promise: Promise) {
        try {
            // 逐个请求，因为 HTTP/1.1 不支持管道
            val results = Arguments.createArray()
            val keys = requests.keySetIterator()
            while (keys.hasNextKey()) {
                val key = keys.nextKey()
                val item = requests.getMap(key)
                val title = item?.getString("title") ?: ""
                val artist = item?.getString("artist") ?: ""

                try {
                    val encodedTitle = urlEncode(title)
                    val encodedArtist = urlEncode(artist)
                    val path = "/v1/lyric?title=$encodedTitle&artist=$encodedArtist"
                    val response = doRequest(path)
                    val lyricMap = parseLyricResponse(response)
                    val result = Arguments.createMap()
                    result.putString("key", key)
                    result.putMap("lyric", lyricMap)
                    results.pushMap(result)
                } catch (e: Exception) {
                    // 单项失败不影响其他项
                    val result = Arguments.createMap()
                    result.putString("key", key)
                    result.putNull("lyric")
                    results.pushMap(result)
                }
            }
            promise.resolve(results)
        } catch (e: Exception) {
            promise.reject("BATCH_FAILED", "Batch fetch failed: ${e.message}")
        }
    }

    /**
     * 通过 AF_UNIX socket 发送 HTTP GET 请求
     */
    private fun doRequest(path: String): String {
        val socket = LocalSocket()
        try {
            val address = LocalSocketAddress(SOCKET_NAME, LocalSocketAddress.Namespace.ABSTRACT)
            socket.connect(address, CONNECT_TIMEOUT_MS)

            val request = "GET $path HTTP/1.1\r\n\r\n"
            socket.outputStream.use { output ->
                output.write(request.toByteArray())
                output.flush()
            }

            val response = StringBuilder()
            socket.inputStream.use { input ->
                val buffer = ByteArray(8192)
                var totalRead = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1 || read == 0) break
                    response.append(String(buffer, 0, read))
                    totalRead += read
                    if (totalRead > MAX_RESPONSE_SIZE) break
                }
            }

            return response.toString()
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * 解析 HTTP 响应，返回 body 部分
     */
    private fun parseBody(httpResponse: String): String {
        val headerEnd = httpResponse.indexOf("\r\n\r\n")
        return if (headerEnd >= 0) {
            httpResponse.substring(headerEnd + 4)
        } else {
            httpResponse
        }
    }

    /**
     * 解析健康检查响应
     */
    private fun parseHealthResponse(response: String): ReadableMap {
        val body = parseBody(response)
        val map = Arguments.createMap()
        try {
            val json = JSONObject(body)
            map.putString("status", json.optString("status", "unknown"))
            map.putInt("protocolVersion", json.optInt("protocolVersion", 0))
        } catch (e: Exception) {
            map.putString("status", "error")
            map.putString("raw", body)
        }
        return map
    }

    /**
     * 解析歌词响应
     * 响应格式:
     * {
     *   "requestId": 3,
     *   "title": "归途有风",
     *   "artist": "海来阿木",
     *   "lines": [{"timeMs": 0, "text": "归途有风"}, ...]
     * }
     */
    private fun parseLyricResponse(response: String): ReadableMap {
        val body = parseBody(response)
        val map = Arguments.createMap()
        try {
            val json = JSONObject(body)
            map.putInt("requestId", json.optInt("requestId", 0))
            map.putString("title", json.optString("title", ""))
            map.putString("artist", json.optString("artist", ""))

            val linesArray = Arguments.createArray()
            val lines = json.optJSONArray("lines")
            if (lines != null) {
                for (i in 0 until lines.length()) {
                    val line = lines.getJSONObject(i)
                    val lineMap = Arguments.createMap()
                    lineMap.putInt("timeMs", line.optInt("timeMs", 0))
                    lineMap.putString("text", line.optString("text", ""))
                    linesArray.pushMap(lineMap)
                }
            }
            map.putArray("lines", linesArray)

            // 同时生成 LRC 格式文本
            val lrcBuilder = StringBuilder()
            if (lines != null) {
                for (i in 0 until lines.length()) {
                    val line = lines.getJSONObject(i)
                    val timeMs = line.optInt("timeMs", 0)
                    val text = line.optString("text", "")
                    val minutes = timeMs / 60000
                    val seconds = (timeMs % 60000) / 1000
                    val millis = timeMs % 1000
                    lrcBuilder.append(String.format("[%02d:%02d.%02d]%s\n", minutes, seconds, millis / 10, text))
                }
            }
            map.putString("rawLrc", lrcBuilder.toString())

        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse lyric response: $body", e)
            map.putString("error", "Failed to parse response")
            map.putString("raw", body)
        }
        return map
    }

    /**
     * 解析封面响应
     * 响应格式:
     * {
     *   "requestId": 5,
     *   "title": "归途有风",
     *   "artist": "海来阿木",
     *   "coverUrl": "https://..."
     * }
     */
    private fun parseCoverResponse(response: String): ReadableMap {
        val body = parseBody(response)
        val map = Arguments.createMap()
        try {
            val json = JSONObject(body)
            map.putInt("requestId", json.optInt("requestId", 0))
            map.putString("title", json.optString("title", ""))
            map.putString("artist", json.optString("artist", ""))
            map.putString("coverUrl", json.optString("coverUrl", ""))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse cover response: $body", e)
            map.putString("error", "Failed to parse response")
            map.putString("raw", body)
        }
        return map
    }

    /**
     * URL 编码
     */
    private fun urlEncode(str: String): String {
        return try {
            URLEncoder.encode(str, "UTF-8")
        } catch (e: Exception) {
            str
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}