/**
 * 命令解析器
 * 将自然语言（中文）解析为音乐播放器命令
 * 参考 remote_watch_mcp 项目的解析模式
 */

const HELP_TEXT = `🎵 MusicFree 音乐控制指令帮助

🎶 【播放控制】
"播放周杰伦的稻香" / "放一首稻香" / "来首周杰伦"
直接说歌名/歌手也能识别播放

⏯️ 【播放/暂停】
"暂停" / "停一下" / "别放了"
"继续" / "接着放" / "开始播放"

⏭️ 【切歌】
"下一首" / "切歌" / "换一首"
"上一首" / "回到上一首"

🔊 【音量控制】
"音量调到 50" / "声音 30"
"大点声" / "大声点" / "调大音量"
"小点声" / "小声点" / "调小音量"

🔁 【播放模式】
"随机播放" / "顺序播放" / "单曲循环" / "列表循环"

📊 【状态查询】
"现在放的什么歌" / "当前播放" / "播放器状态"

❓ 输入"帮助"显示此列表`;

class CommandParser {
    constructor(config = {}) {
        this.playPrefix = config.playPrefix || ["播放", "放一首", "来一首", "听", "我想听", "播放一首", "放", "放个", "来个", "点一首", "点歌"];
        this.pauseKeywords = config.pauseKeywords || ["暂停", "停一下", "停止播放", "别放了", "停", "停下"];
        this.resumeKeywords = config.resumeKeywords || ["继续", "继续播放", "接着放", "开始", "开始播放", "继续放"];
        this.nextKeywords = config.nextKeywords || ["下一首", "切歌", "换一首", "下一曲", "跳过", "下一个", "换歌"];
        this.prevKeywords = config.prevKeywords || ["上一首", "上一曲", "回到上一首", "上一个", "回上一首"];
        this.searchKeywords = config.searchKeywords || ["搜索", "查找", "找"];
        this.volumeKeywords = config.volumeKeywords || ["音量", "声音"];
        this.volumeUpKeywords = config.volumeUpKeywords || ["大点声", "大声点", "声音大点", "音量大", "调大音量", "开大点", "声音开大点"];
        this.volumeDownKeywords = config.volumeDownKeywords || ["小点声", "小声点", "声音小点", "音量小", "调小音量", "开小点", "声音开小点"];
        this.helpKeywords = config.helpKeywords || ["帮助", "help", "指令", "命令", "能做什么", "有什么功能", "怎么用", "使用说明"];
        this.statusKeywords = config.statusKeywords || ["状态", "播放状态", "现在放的什么", "放的什么歌", "当前播放", "什么歌", "现在的歌"];
        this.repeatKeywords = config.repeatKeywords || ["循环模式", "播放模式", "随机", "单曲循环", "列表循环", "顺序播放"];
        this.muteKeywords = config.muteKeywords || ["静音", "消音", "没声"];
        this.unmuteKeywords = config.unmuteKeywords || ["取消静音", "恢复声音", "有声音"];
    }

    getHelpText() {
        return HELP_TEXT;
    }

    /**
     * 解析用户输入的文本
     * @param {string} text - 用户输入的自然语言
     * @returns {object} - 解析结果 { type, data, reply }
     */
    parse(text) {
        if (!text || typeof text !== "string") {
            return { type: "unknown", reply: "请告诉我你想做什么~" };
        }

        const normalized = text.trim();

        // 帮助
        if (this._matchKeywords(normalized, this.helpKeywords)) {
            return { type: "help", reply: this.getHelpText() };
        }

        // 状态查询
        if (this._matchKeywords(normalized, this.statusKeywords)) {
            return { type: "status", reply: "正在查询播放器状态..." };
        }

        // 静音
        if (this._matchKeywords(normalized, this.muteKeywords)) {
            return { type: "mute", reply: "好的，已静音" };
        }

        // 取消静音
        if (this._matchKeywords(normalized, this.unmuteKeywords)) {
            return { type: "unmute", reply: "好的，已取消静音" };
        }

        // 暂停
        if (this._matchKeywords(normalized, this.pauseKeywords)) {
            return { type: "pause", reply: "好的，已暂停播放" };
        }

        // 继续播放
        if (this._matchKeywords(normalized, this.resumeKeywords)) {
            return { type: "play", reply: "好的，继续播放" };
        }

        // 下一首
        if (this._matchKeywords(normalized, this.nextKeywords)) {
            return { type: "next", reply: "好的，切到下一首" };
        }

        // 上一首
        if (this._matchKeywords(normalized, this.prevKeywords)) {
            return { type: "previous", reply: "好的，回到上一首" };
        }

        // 音量调大
        if (this._matchKeywords(normalized, this.volumeUpKeywords)) {
            return { type: "volume_up", reply: "好的，已调大音量" };
        }

        // 音量调小
        if (this._matchKeywords(normalized, this.volumeDownKeywords)) {
            return { type: "volume_down", reply: "好的，已调小音量" };
        }

        // 设置具体音量
        const volumeMatch = normalized.match(/(?:音量|声音)(?:调到|调为|是)?\s*(\d{1,3})/);
        if (volumeMatch) {
            const vol = parseInt(volumeMatch[1]);
            if (vol >= 0 && vol <= 100) {
                return { type: "volume_set", data: vol / 100, reply: `好的，音量已调到 ${vol}%` };
            }
        }

        // 播放模式切换
        if (normalized.includes("随机") || normalized.includes("随机播放")) {
            return { type: "repeat_mode", data: "shuffle", reply: "好的，已切换到随机播放" };
        }
        if (normalized.includes("单曲循环") || normalized.includes("单曲")) {
            return { type: "repeat_mode", data: "single", reply: "好的，已切换到单曲循环" };
        }
        if (normalized.includes("列表循环") || normalized.includes("循环播放")) {
            return { type: "repeat_mode", data: "list", reply: "好的，已切换到列表循环" };
        }
        if (normalized.includes("顺序播放") || normalized.includes("顺序")) {
            return { type: "repeat_mode", data: "order", reply: "好的，已切换到顺序播放" };
        }

        // 搜索并播放（核心）
        const playQuery = this._extractPlayQuery(normalized);
        if (playQuery) {
            return {
                type: "play_search",
                data: playQuery,
                reply: `好的，正在为你播放「${playQuery}」`,
            };
        }

        // 纯搜索（不播放）
        const searchQuery = this._extractSearchQuery(normalized);
        if (searchQuery) {
            return {
                type: "search",
                data: searchQuery,
                reply: `正在搜索「${searchQuery}」...`,
            };
        }

        // 如果只说了歌名/歌手（没有前缀），也尝试播放
        if (normalized.length >= 2 && normalized.length <= 30) {
            return {
                type: "play_search",
                data: normalized,
                reply: `好的，正在为你播放「${normalized}」`,
            };
        }

        return { type: "unknown", reply: "抱歉，我没有理解你的意思。你可以说：播放周杰伦的稻香、暂停、下一首等~输入「帮助」查看所有指令" };
    }

    _matchKeywords(text, keywords) {
        return keywords.some(kw => text.includes(kw));
    }

    _extractPlayQuery(text) {
        for (const prefix of this.playPrefix) {
            if (text.startsWith(prefix)) {
                const query = text.slice(prefix.length).trim();
                // 清理 "一首"、"一曲" 等后缀
                const cleaned = query
                    .replace(/^(一首|一曲|一首歌|一首歌曲)\s*/, "")
                    .replace(/\s*(歌|歌曲|音乐)$/, "")
                    .trim();
                if (cleaned) {
                    return cleaned;
                }
            }
        }
        return null;
    }

    _extractSearchQuery(text) {
        for (const prefix of this.searchKeywords) {
            if (text.startsWith(prefix)) {
                const query = text.slice(prefix.length).trim();
                if (query) {
                    return query;
                }
            }
        }
        return null;
    }
}

module.exports = CommandParser;
