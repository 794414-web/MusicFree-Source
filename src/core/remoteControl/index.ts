import { trace, errorLog } from "@/utils/log";
import ApiController from "./apiController";
import { IApiResponse, IRemoteControlConfig } from "./types";
import Config from "@/core/appConfig";

/**
 * 动作路由表 - 将 WebSocket 命令映射到 ApiController 方法
 */
const actionHandlers: Record<string, (params: any) => Promise<IApiResponse> | IApiResponse> = {
    get_status: () => ApiController.getPlayerStatus(),
    play: (p) => ApiController.play(p?.musicItem),
    pause: () => ApiController.pause(),
    toggle: () => ApiController.togglePlay(),
    next: () => ApiController.skipToNext(),
    previous: () => ApiController.skipToPrevious(),
    seek: (p) => ApiController.seekTo(p?.position),
    set_volume: (p) => ApiController.setVolume(p?.volume),
    clear: () => ApiController.clearPlayList(),
    repeat: () => ApiController.toggleRepeatMode(),
    set_repeat_mode: (p) => ApiController.setRepeatMode(p?.mode),
    search: (p) => ApiController.searchMusic(p?.query, p?.page || 1, p?.pluginHash),
    play_search: (p) => ApiController.searchAndPlay(p?.query, p?.pluginHash),
    add_next: (p) => ApiController.addNext(p?.musicItem),
};

/** 最大重连次数，超过后停止重连避免资源耗尽 */
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * 验证 WebSocket URL 格式
 * 必须以 ws:// 或 wss:// 开头，且包含有效的主机地址
 */
function isValidWsUrl(url: string): boolean {
    if (!url || typeof url !== "string") {
        return false;
    }
    const trimmed = url.trim();
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
        return false;
    }
    // 去掉协议头后必须有内容
    const rest = trimmed.replace(/^wss?:\/\//, "");
    if (!rest || rest.length < 3) {
        return false;
    }
    // 简单校验 host:port 格式
    return /^[\w.\-]+(:\d+)?(\/.*)?$/.test(rest);
}

/**
 * 远程控制服务（WebSocket 客户端模式）
 *
 * 【架构】车机主动连接 MCP 服务，而不是开端口等连接
 *  - 好处：不需要车机有公网IP，不需要端口映射，NAT下也能用
 *  - 好处：不需要原生模块（react-native-tcp-socket），React Native 自带 WebSocket
 *  - 好处：不需要重新构建APK，热更新就能用
 */
class RemoteControlService {
    private ws: WebSocket | null = null;
    private reconnectTimer: any = null;
    private heartbeatTimer: any = null;
    private reconnectCount = 0;
    private stopped = false;
    private config: IRemoteControlConfig & { wsUrl?: string } = {
        enabled: true,
        port: 3688,
        allowLanOnly: true,
        wsUrl: "",
    };

    get isRunning() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    get currentConfig() {
        return { ...this.config };
    }

    /**
     * 从应用配置加载远程控制配置
     */
    loadConfig() {
        try {
            const savedConfig = Config.getConfig("remoteControl") as Partial<IRemoteControlConfig & { wsUrl?: string }>;
            if (savedConfig) {
                this.config = { ...this.config, ...savedConfig };
            }
        } catch (e) {
            errorLog("加载远程控制配置失败", e);
        }
        return { ...this.config };
    }

    /**
     * 保存配置
     */
    saveConfig(newConfig: Partial<IRemoteControlConfig & { wsUrl?: string }>) {
        this.config = { ...this.config, ...newConfig };
        try {
            Config.setConfig("remoteControl", this.config);
        } catch (e) {
            errorLog("保存远程控制配置失败", e);
        }
    }

    /**
     * 启动远程控制服务（连接到 MCP 服务器）
     */
    async start(): Promise<boolean> {
        this.loadConfig();
        this.stopped = false;

        if (!this.config.enabled) {
            trace("远程控制服务未启用");
            return false;
        }

        const wsUrl = this.config.wsUrl?.trim();
        if (!wsUrl) {
            trace("未配置 MCP WebSocket 地址，跳过远程控制");
            return false;
        }

        if (!isValidWsUrl(wsUrl)) {
            errorLog("WebSocket 地址格式无效", wsUrl);
            return false;
        }

        if (this.isRunning) {
            trace("远程控制服务已连接");
            return true;
        }

        this.reconnectCount = 0;
        this.connect();
        return true;
    }

    /**
     * 停止远程控制服务
     */
    async stop(): Promise<void> {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopHeartbeat();
        if (this.ws) {
            try {
                // 移除回调避免 stop 触发 onclose 再次重连
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch {
                // ignore
            }
            this.ws = null;
        }
        trace("远程控制服务已停止");
    }

    /**
     * 重启服务
     */
    async restart(): Promise<boolean> {
        await this.stop();
        return this.start();
    }

    /**
     * 建立 WebSocket 连接
     */
    private connect() {
        if (this.stopped) {
            return;
        }

        const wsUrl = this.config.wsUrl?.trim();
        if (!wsUrl || !isValidWsUrl(wsUrl)) {
            errorLog("WebSocket 地址无效，跳过连接");
            return;
        }

        trace(`正在连接 MCP 服务: ${wsUrl.substring(0, 50)}...`);

        // 创建 WebSocket，用 try/catch 包裹同步部分
        let ws: WebSocket;
        try {
            ws = new WebSocket(wsUrl);
        } catch (e: any) {
            errorLog("创建 WebSocket 失败", e?.message || String(e));
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            if (this.stopped || this.ws !== ws) {
                return;
            }
            trace("已连接到 MCP 服务");
            this.reconnectCount = 0;
            this.startHeartbeat();
            this.send({ type: "hello", device: "musicfree-car", version: "1.0" });
        };

        ws.onmessage = async (event: WebSocketMessageEvent) => {
            if (this.stopped || this.ws !== ws) {
                return;
            }
            try {
                // 确保拿到的是字符串
                const rawData = event?.data;
                if (typeof rawData !== "string") {
                    return;
                }
                const msg = JSON.parse(rawData);
                trace(`收到命令: ${msg.action || msg.type}${msg.id ? ` (id=${msg.id})` : ""}`);

                if (msg.type === "ping") {
                    this.send({ type: "pong", id: msg.id });
                    return;
                }

                if (msg.action) {
                    const result = await this.handleAction(msg.action, msg.params || {});
                    if (msg.id) {
                        this.send({ type: "response", id: msg.id, result });
                    }
                }
            } catch (e: any) {
                errorLog("处理命令失败", e?.message || String(e));
            }
        };

        ws.onerror = (e: any) => {
            if (this.stopped || this.ws !== ws) {
                return;
            }
            // RN 的 onerror event 没有 message 字段，不要访问可能不存在的属性
            errorLog("WebSocket 错误");
        };

        ws.onclose = (e: WebSocketCloseEvent) => {
            if (this.stopped || this.ws !== ws) {
                return;
            }
            trace(`连接关闭: code=${e?.code}, reason=${e?.reason || "无"}`);
            this.stopHeartbeat();
            this.ws = null;
            // 仅在配置仍启用且未超过重连上限时才重连
            if (this.config.enabled && !this.stopped) {
                this.scheduleReconnect();
            }
        };
    }

    /**
     * 处理一条命令
     */
    private async handleAction(action: string, params: any): Promise<IApiResponse> {
        const handler = actionHandlers[action];
        if (!handler) {
            return { code: -1, message: `未知命令: ${action}` };
        }
        try {
            return await handler(params);
        } catch (e: any) {
            errorLog(`执行命令 ${action} 失败`, e?.message || String(e));
            return { code: -1, message: e?.message || "执行失败" };
        }
    }

    /**
     * 发送消息
     */
    private send(msg: any) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            this.ws.send(JSON.stringify(msg));
            return true;
        } catch (e: any) {
            errorLog("发送消息失败", e?.message || String(e));
            return false;
        }
    }

    /**
     * 定时重连（带最大次数限制，避免无限重连耗尽资源）
     */
    private scheduleReconnect() {
        if (this.stopped) {
            return;
        }
        if (this.reconnectTimer) {
            return;
        }
        this.reconnectCount++;
        if (this.reconnectCount > MAX_RECONNECT_ATTEMPTS) {
            errorLog(`已达到最大重连次数 ${MAX_RECONNECT_ATTEMPTS}，停止重连`);
            this.reconnectCount = 0;
            return;
        }
        const delay = Math.min(3000 * this.reconnectCount, 60000);
        trace(`${delay / 1000}秒后重连 MCP 服务 (第${this.reconnectCount}次)`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    /**
     * 心跳保活
     */
    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.send({ type: "ping" });
        }, 30000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}

const remoteControlService = new RemoteControlService();
export default remoteControlService;
export { actionHandlers };
