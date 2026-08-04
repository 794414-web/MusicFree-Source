/**
 * 小智 AI MCP WebSocket 客户端
 * 参考 remote_watch_mcp 项目的 mcp_server_api.py 实现
 * 支持：MCP 协议通信、断线自动重连、工具调用
 */

const WebSocket = require("ws");

const PROTOCOL_VERSION = "2024-11-05";

class XiaozhiClient {
    constructor(config, options = {}) {
        this.wsUrl = (config.wsUrl || "").trim();
        this.autoReconnect = config.autoReconnect !== false;
        this.maxReconnectDelay = config.maxReconnectDelay || 60000;
        this.baseReconnectDelay = config.baseReconnectDelay || 5000;

        this.onMessage = options.onMessage || null;
        this.getTools = options.getTools || (() => []);
        this.callTool = options.callTool || (async () => ({ content: [{ type: "text", text: "未实现" }] }));

        this.ws = null;
        this.reconnectCount = 0;
        this.initialized = false;
        this.isConnecting = false;

        // 定时发送心跳
        this.heartbeatInterval = null;
    }

    isConfigured() {
        return !!this.wsUrl;
    }

    async connect() {
        if (!this.isConfigured()) {
            console.log("[Xiaozhi] 未配置 WebSocket URL，跳过连接");
            return;
        }
        if (this.isConnecting) {
            console.log("[Xiaozhi] 正在连接中，跳过重复连接请求");
            return;
        }

        this.isConnecting = true;
        this.reconnectCount++;

        console.log(`[Xiaozhi] 正在建立WebSocket连接... (第${this.reconnectCount}次)`);

        try {
            this.ws = new WebSocket(this.wsUrl, {
                handshakeTimeout: 15000,
                maxPayload: 1024 * 1024,
            });

            this.ws.on("open", () => {
                console.log("✅ [Xiaozhi] WebSocket连接成功！等待接收消息...");
                this.reconnectCount = 0;
                this.initialized = false;
                this.isConnecting = false;
                this._startHeartbeat();
            });

            this.ws.on("message", async (data) => {
                try {
                    const message = data.toString();
                    const response = await this._processMessage(message);
                    if (response !== null && this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(response);
                    }
                } catch (e) {
                    console.error("[Xiaozhi] 处理消息错误:", e.message);
                }
            });

            this.ws.on("close", (code, reason) => {
                console.log(`⚠️  [Xiaozhi] 连接关闭: code=${code}, reason=${reason || "无"}`);
                this._stopHeartbeat();
                this.isConnecting = false;
                this.initialized = false;

                if (this.autoReconnect) {
                    this._scheduleReconnect();
                }
            });

            this.ws.on("error", (error) => {
                console.error(`❌ [Xiaozhi] 连接错误: ${error.message}`);
                this.isConnecting = false;
            });

            this.ws.on("ping", () => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.pong();
                }
            });

        } catch (e) {
            console.error(`❌ [Xiaozhi] 创建连接失败: ${e.message}`);
            this.isConnecting = false;
            if (this.autoReconnect) {
                this._scheduleReconnect();
            }
        }
    }

    _scheduleReconnect() {
        const delay = Math.min(
            this.baseReconnectDelay * this.reconnectCount,
            this.maxReconnectDelay
        );
        console.log(`[Xiaozhi] ${delay / 1000}秒后重新连接... (已重连${this.reconnectCount}次)`);
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);
    }

    _stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    disconnect() {
        this.autoReconnect = false;
        this._stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        console.log("[Xiaozhi] 已断开连接");
    }

    // ============================================================
    // MCP 协议处理
    // ============================================================

    async _processMessage(message) {
        try {
            const data = JSON.parse(message);
            const method = data.method;
            const params = data.params || {};
            const requestId = data.id;

            console.log(`[Xiaozhi] 收到消息: method=${method}, id=${requestId}`);

            if (method === "initialize") {
                const response = {
                    jsonrpc: "2.0",
                    id: requestId,
                    result: {
                        protocolVersion: PROTOCOL_VERSION,
                        capabilities: {
                            tools: {},
                            logging: {},
                        },
                        serverInfo: {
                            name: "musicfree-mcp-server",
                            version: "2.0.0 (飞书/企业微信/小智AI三合一)",
                        },
                    },
                };
                return JSON.stringify(response);
            }

            if (method === "notifications/initialized") {
                console.log(">>> [Xiaozhi] 初始化完成，握手成功！");
                this.initialized = true;
                return null;
            }

            if (method === "tools/list") {
                const tools = this.getTools();
                const response = {
                    jsonrpc: "2.0",
                    id: requestId,
                    result: { tools },
                };
                return JSON.stringify(response);
            }

            if (method === "tools/call") {
                const toolName = params.name;
                const args = params.arguments || {};
                console.log(`>>> [Xiaozhi] 调用工具: ${toolName}, 参数: ${JSON.stringify(args)}`);

                const result = await this.callTool(toolName, args);

                // 构建 content 数组
                let content = [];
                if (typeof result === "object" && result !== null) {
                    if (result.content) {
                        content = result.content;
                    } else if (result.text) {
                        content.push({ type: "text", text: result.text });
                    } else {
                        content.push({ type: "text", text: JSON.stringify(result, null, 2) });
                    }
                } else {
                    content.push({ type: "text", text: String(result) });
                }

                const response = {
                    jsonrpc: "2.0",
                    id: requestId,
                    result: { content },
                };
                console.log(`>>> [Xiaozhi] 工具调用完成，返回 ${content.length} 个内容项`);
                return JSON.stringify(response);
            }

            if (method === "ping") {
                const response = {
                    jsonrpc: "2.0",
                    id: requestId,
                    result: {},
                };
                return JSON.stringify(response);
            }

            // 未知方法
            const response = {
                jsonrpc: "2.0",
                id: requestId,
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`,
                },
            };
            return JSON.stringify(response);

        } catch (e) {
            console.error("[Xiaozhi] 处理消息错误:", e);
            const response = {
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32603,
                    message: String(e.message || e),
                },
            };
            return JSON.stringify(response);
        }
    }

    // 主动发送通知消息（可选）
    sendNotification(method, params = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        const msg = {
            jsonrpc: "2.0",
            method,
            params,
        };
        this.ws.send(JSON.stringify(msg));
        return true;
    }
}

module.exports = XiaozhiClient;
