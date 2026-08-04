/**
 * MusicFree 车机客户端（双模式）
 * 
 * 模式 1：HTTP 模式（传统）- MCP 主动连接车机 IP:3688
 * 模式 2：WebSocket 模式（推荐）- 车机主动连接 MCP 服务的 /ws 路径
 * 
 * 【为什么推荐 WebSocket 模式】
 * - 不需要知道车机 IP，不需要端口映射
 * - 车机在 NAT/4G 网络下也能用
 * - 不需要 react-native-tcp-socket 原生模块，APK 不用重编译
 * - 断线自动重连
 */

const axios = require("axios");

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class MusicFreeClient {
    /**
     * @param {object} config
     * @param {string} config.baseUrl - HTTP 模式的车机地址（如 http://192.168.1.100:3688）
     * @param {string} config.accessToken
     * @param {object} config.wsManager - WebSocket 连接管理器
     */
    constructor(config = {}, wsManager = null) {
        this.baseUrl = (config.baseUrl || "").replace(/\/$/, "");
        this.accessToken = config.accessToken || "";
        this.wsManager = wsManager;

        if (this.baseUrl) {
            this.client = axios.create({
                baseURL: this.baseUrl,
                timeout: 30000,
            });
        }
    }

    _getHeaders() {
        const headers = {};
        if (this.accessToken) {
            headers["Authorization"] = `Bearer ${this.accessToken}`;
        }
        return headers;
    }

    async _requestHttp(method, path, params = {}, data = {}) {
        if (!this.client) {
            return { code: -1, message: "未配置 baseUrl，HTTP 模式不可用" };
        }
        try {
            const response = await this.client.request({
                method,
                url: path,
                params,
                data,
                headers: this._getHeaders(),
            });
            return response.data;
        } catch (error) {
            if (error.response) {
                return error.response.data;
            }
            return { code: -1, message: `连接车机失败: ${error.message}` };
        }
    }

    /**
     * 通过 WebSocket 发送命令到车机（推荐模式）
     */
    async _requestWs(action, params = {}) {
        if (!this.wsManager || !this.wsManager.hasCar()) {
            return { code: -1, message: "没有车机连接到 MCP 服务，请先在车机 APP 中配置 MCP 地址" };
        }
        try {
            return await this.wsManager.sendCommand(action, params);
        } catch (e) {
            return { code: -1, message: e.message || "命令执行超时" };
        }
    }

    /**
     * 优先用 WebSocket，没有连接再用 HTTP
     */
    async _request(action, method, path, params = {}, data = {}) {
        // WebSocket 模式（优先）- 合并 params 和 data
        if (this.wsManager && this.wsManager.hasCar()) {
            return this._requestWs(action, { ...params, ...data });
        }
        // HTTP 模式（备选）
        return this._requestHttp(method, path, params, data);
    }

    // ========== 状态查询 ==========
    async getStatus() {
        return this._request("get_status", "GET", "/api/status");
    }

    // ========== 播放控制 ==========
    async play(musicItem) {
        return this._request("play", "POST", "/api/play", {}, { musicItem });
    }

    async pause() {
        return this._request("pause", "POST", "/api/pause");
    }

    async toggle() {
        return this._request("toggle", "POST", "/api/toggle");
    }

    async next() {
        return this._request("next", "POST", "/api/next");
    }

    async previous() {
        return this._request("previous", "POST", "/api/previous");
    }

    // ========== 音量控制 ==========
    async setVolume(volume) {
        return this._request("set_volume", "POST", "/api/volume", {}, { volume });
    }

    // ========== 播放进度 ==========
    async seekTo(position) {
        return this._request("seek", "POST", "/api/seek", {}, { position });
    }

    // ========== 搜索和播放（核心）==========
    async search(query, page = 1, pluginHash) {
        return this._request("search", "GET", "/api/search", { query, page, pluginHash });
    }

    /**
     * 搜索并播放（一句话控制 - 最核心接口）
     * 音乐搜索由车机内置 plugins 完成，MCP 只转发命令
     * @param {string} query - 搜索词，例如 "周杰伦的稻香"、"稻香"、"周杰伦"
     */
    async searchAndPlay(query) {
        return this._request("play_search", "POST", "/api/play-search", {}, { query: query.trim() });
    }

    // ========== 播放列表 ==========
    async clearPlayList() {
        return this._request("clear", "POST", "/api/clear");
    }

    // ========== 播放模式 ==========
    async toggleRepeat() {
        return this._request("repeat", "POST", "/api/repeat");
    }

    /**
     * 设置播放模式
     * @param {string} mode - order | list | single | shuffle
     */
    async setRepeatMode(mode) {
        return this._request("set_repeat_mode", "POST", "/api/repeat-mode", {}, { mode });
    }
}

module.exports = MusicFreeClient;
