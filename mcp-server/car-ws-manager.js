/**
 * 车机 WebSocket 连接管理器
 * 
 * 负责：
 * - 管理车机连接（目前只支持一台车机，后续可扩展多设备）
 * - 发送命令并等待响应
 * - 连接状态追踪
 */

const { EventEmitter } = require("events");

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class CarWsManager extends EventEmitter {
    constructor() {
        super();
        this.carWs = null;
        this.carInfo = null;
        this.pendingRequests = new Map(); // id -> { resolve, reject, timer }
        this.responseTimeout = 30000; // 30秒超时
    }

    /**
     * 注册一个新的车机连接
     */
    registerCar(ws, info) {
        // 如果已有连接，先关闭旧的
        if (this.carWs && this.carWs !== ws) {
            try {
                this.carWs.close();
            } catch (e) {
                // ignore
            }
        }

        this.carWs = ws;
        this.carInfo = info || { device: "musicfree-car" };
        console.log(`🚗  车机已连接: ${JSON.stringify(this.carInfo)}`);
        this.emit("car-connected", this.carInfo);

        ws.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this._handleMessage(msg);
            } catch (e) {
                console.error("解析车机消息失败:", e.message);
            }
        });

        ws.on("close", () => {
            console.log("⚠️  车机连接断开");
            if (this.carWs === ws) {
                this.carWs = null;
                this.carInfo = null;
            }
            this.emit("car-disconnected");
            // 清理所有未完成的请求
            this.pendingRequests.forEach((req) => {
                clearTimeout(req.timer);
                req.reject(new Error("车机连接断开"));
            });
            this.pendingRequests.clear();
        });

        ws.on("error", (err) => {
            console.error("车机 WebSocket 错误:", err.message);
        });
    }

    /**
     * 处理从车机收到的消息
     */
    _handleMessage(msg) {
        if (msg.type === "hello") {
            this.carInfo = { ...this.carInfo, ...msg };
            console.log(`🚗  车机注册信息: ${JSON.stringify(this.carInfo)}`);
            return;
        }

        if (msg.type === "pong") {
            return;
        }

        if (msg.type === "response" && msg.id) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.id);
                pending.resolve(msg.result);
            }
            return;
        }

        // 其他类型（车机主动推送的事件，比如播放状态变化）
        if (msg.type === "event") {
            this.emit("car-event", msg.data);
        }
    }

    /**
     * 是否有车机连接
     */
    hasCar() {
        return this.carWs !== null && this.carWs.readyState === 1; // 1 = OPEN
    }

    /**
     * 获取当前连接的车机信息
     */
    getCarInfo() {
        return this.carInfo;
    }

    /**
     * 发送命令到车机并等待响应
     * @param {string} action - 命令名，如 play_search, pause, next
     * @param {object} params - 参数
     */
    sendCommand(action, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.hasCar()) {
                reject(new Error("没有车机连接"));
                return;
            }

            const id = genId();
            const msg = { id, action, params };

            // 设置超时
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`命令 ${action} 超时`));
            }, this.responseTimeout);

            this.pendingRequests.set(id, { resolve, reject, timer });

            try {
                this.carWs.send(JSON.stringify(msg));
            } catch (e) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(e);
            }
        });
    }
}

module.exports = CarWsManager;
