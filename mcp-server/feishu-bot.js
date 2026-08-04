/**
 * 飞书群消息客户端
 * 参考 remote_watch_mcp 项目的 feishu_client.py 实现
 * 支持：token 自动刷新、消息轮询/回调、图片发送、群成员缓存、消息去重
 */

const axios = require("axios");
const crypto = require("crypto");

class FeishuBot {
    constructor(config, onMessage) {
        this.appId = (config.appId || "").trim();
        this.appSecret = (config.appSecret || "").trim();
        this.chatId = (config.chatId || "").trim();
        this.verificationToken = (config.verificationToken || "").trim();
        this.encryptKey = (config.encryptKey || "").trim();
        this.botWebhookUrl = (config.botWebhookUrl || "").trim();
        this.onMessage = onMessage;

        this.tenantAccessToken = "";
        this.tokenExpireTime = 0;

        // 消息轮询
        this.lastMessageId = null;
        this.pollingInterval = null;
        this.pollingEnabled = !!config.enablePolling;
        this.pollingIntervalMs = config.pollingIntervalMs || 5000;

        // 消息去重
        this._processedMsgIds = new Set();
        this._msgCacheTTL = 3600;

        // 群成员缓存
        this._chatMembers = {};
        this._membersCacheTime = 0;
        this._membersCacheTTL = 3600;

        this.session = axios.create({
            baseURL: "https://open.feishu.cn/open-apis",
            timeout: 15000,
            headers: {
                "User-Agent": "MusicFreeMCP/1.0",
            },
        });
    }

    isConfigured() {
        return !!(this.appId && this.appSecret && this.chatId);
    }

    // ============================================================
    // Token 管理
    // ============================================================

    async getTenantAccessToken() {
        const now = Date.now();
        if (this.tenantAccessToken && now < this.tokenExpireTime - 120000) {
            return this.tenantAccessToken;
        }

        if (!this.appId || !this.appSecret) {
            return null;
        }

        try {
            const response = await this.session.post(
                "/auth/v3/tenant_access_token/internal",
                {
                    app_id: this.appId,
                    app_secret: this.appSecret,
                }
            );

            if (response.data.code === 0) {
                this.tenantAccessToken = response.data.tenant_access_token;
                this.tokenExpireTime = now + response.data.expire * 1000;
                return this.tenantAccessToken;
            }
            const maskedId = this.appId.length > 6
                ? this.appId.slice(0, 4) + "****" + this.appId.slice(-2)
                : "***";
            console.error(
                `[Feishu] 获取token失败: code=${response.data.code}, msg=${response.data.msg}`
            );
            console.error(`[Feishu]   app_id=${maskedId}`);
            return null;
        } catch (e) {
            console.error("[Feishu] 获取token异常:", e.message);
            return null;
        }
    }

    _authHeaders() {
        const token = this.tenantAccessToken || this.getTenantAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    // ============================================================
    // 消息获取（轮询模式）
    // ============================================================

    async getMessages(pageSize = 20) {
        if (!this.isConfigured()) {
            return { success: false, message: "飞书未配置" };
        }
        const token = await this.getTenantAccessToken();
        if (!token) {
            return { success: false, message: "获取token失败" };
        }

        try {
            const url =
                `/im/v1/messages` +
                `?container_id=${this.chatId}` +
                `&container_type=chat` +
                `&container_id_type=chat` +
                `&sort_type=ByCreateTimeDesc` +
                `&page_size=${pageSize}`;

            const resp = await this.session.get(url, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (resp.data.code === 0) {
                const items = resp.data.data?.items || [];
                const messages = items.map(item => this._parseMessage(item));
                return { success: true, messages };
            }
            return { success: false, message: resp.data.msg || `错误码: ${resp.data.code}` };
        } catch (e) {
            return { success: false, message: `网络错误: ${e.message}` };
        }
    }

    _parseMessage(item) {
        const msgId = item.message_id || "";
        const msgType = item.msg_type || "text";
        const createTime = item.create_time || "0";

        let senderName = "未知";
        let senderId = "";
        const sender = item.sender || {};
        senderId = sender.id || "";
        const senderType = sender.sender_type || "";
        if (sender.sender_name) {
            senderName = sender.sender_name;
        } else if (sender.name) {
            senderName = sender.name;
        } else if (senderType === "app") {
            senderName = "机器人";
        } else if (senderType === "user" && senderId) {
            const memberName = this.getMemberName(senderId);
            if (memberName) senderName = memberName;
        }

        const body = item.body || {};
        const contentStr = body.content || "{}";
        let text = "[未知消息类型]";

        try {
            const content = typeof contentStr === "string" ? JSON.parse(contentStr) : contentStr;
            if (msgType === "text") {
                text = content.text || contentStr;
            } else if (msgType === "image") {
                text = "[图片]";
            } else if (msgType === "file") {
                text = `[文件] ${content.file_name || ""}`;
            } else if (msgType === "post") {
                text = this._parsePostContent(content);
            } else if (msgType === "audio") {
                text = "[语音消息]";
            } else if (msgType === "video") {
                text = "[视频消息]";
            }
        } catch (e) {
            text = `[解析失败: ${e.message}]`;
        }

        let timeStr = createTime;
        try {
            const ts = parseInt(createTime) / 1000;
            const tm = new Date(ts * 1000);
            timeStr = tm.toLocaleString("zh-CN");
        } catch (_) {}

        return {
            message_id: msgId,
            msg_type: msgType,
            sender_name: senderName,
            sender_id: senderId,
            sender_type: senderType,
            content: text,
            create_time: timeStr,
            timestamp: parseInt(createTime) || 0,
        };
    }

    _parsePostContent(content) {
        try {
            let postData = content;
            if (content.zh_cn) postData = content.zh_cn;
            else if (content.en_us) postData = content.en_us;

            const title = postData.title || "";
            const contentLines = postData.content || [];
            const lines = [];
            if (title) lines.push(`【${title}】`);
            for (const lineItems of contentLines) {
                let lineText = "";
                for (const item of lineItems) {
                    const tag = item.tag || "";
                    if (tag === "text") lineText += item.text || "";
                    else if (tag === "a") lineText += item.text || "";
                    else if (tag === "at") lineText += `@${item.user_name || "某人"}`;
                }
                if (lineText) lines.push(lineText);
            }
            return lines.length ? lines.join("\n") : "[富文本消息]";
        } catch (_) {
            return "[富文本消息]";
        }
    }

    async checkNewMessages() {
        const result = await this.getMessages(20);
        if (!result.success) return result;

        const messages = result.messages || [];
        if (!messages.length) {
            return { success: true, new_count: 0, messages: [] };
        }

        if (this.lastMessageId === null) {
            this.lastMessageId = messages[0].message_id;
            return { success: true, new_count: 0, messages: [] };
        }

        const newMessages = [];
        for (const msg of messages) {
            if (msg.message_id === this.lastMessageId) break;
            newMessages.push(msg);
        }

        if (newMessages.length) {
            this.lastMessageId = newMessages[0].message_id;
        }

        return {
            success: true,
            new_count: newMessages.length,
            messages: newMessages,
        };
    }

    // ============================================================
    // 轮询控制
    // ============================================================

    startPolling() {
        if (this.pollingInterval) {
            console.log("[Feishu] 轮询已在运行");
            return;
        }
        if (!this.isConfigured()) {
            console.log("[Feishu] 未配置，无法启动轮询");
            return;
        }
        console.log(`[Feishu] 启动消息轮询，间隔 ${this.pollingIntervalMs}ms`);
        this.pollingInterval = setInterval(async () => {
            try {
                const result = await this.checkNewMessages();
                if (result.success && result.new_count > 0) {
                    for (const msg of result.messages) {
                        if (msg.sender_type === "app") continue;
                        if (this._processedMsgIds.has(msg.message_id)) continue;
                        this._processedMsgIds.add(msg.message_id);

                        if (msg.msg_type === "text" && this.onMessage) {
                            const cleanText = msg.content.replace(/@_user_\d+/g, "").trim();
                            if (cleanText) {
                                const reply = await this.onMessage(cleanText, {
                                    platform: "feishu",
                                    messageId: msg.message_id,
                                    chatId: this.chatId,
                                    senderId: msg.sender_id,
                                    senderName: msg.sender_name,
                                });
                                if (reply) {
                                    await this.sendMessage(reply);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("[Feishu] 轮询异常:", e.message);
            }
        }, this.pollingIntervalMs);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log("[Feishu] 已停止消息轮询");
        }
    }

    // ============================================================
    // 群成员管理
    // ============================================================

    async loadChatMembers(forceRefresh = false) {
        if (!this.isConfigured()) {
            return { success: false, message: "飞书未配置" };
        }
        const now = Date.now();
        if (!forceRefresh && Object.keys(this._chatMembers).length > 0 &&
            (now - this._membersCacheTime) < this._membersCacheTTL * 1000) {
            return { success: true, count: Object.keys(this._chatMembers).length, cached: true };
        }

        const token = await this.getTenantAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const allMembers = {};
            let pageToken = "";
            let hasMore = true;

            while (hasMore) {
                let url = `/im/v1/chats/${this.chatId}/members?member_id_type=open_id&page_size=100`;
                if (pageToken) url += `&page_token=${pageToken}`;

                const resp = await this.session.get(url, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (resp.data.code !== 0) {
                    return { success: false, message: resp.data.msg || `错误码: ${resp.data.code}` };
                }
                const items = resp.data.data?.items || [];
                for (const m of items) {
                    if (m.member_id) allMembers[m.member_id] = m.name || "";
                }
                hasMore = resp.data.data?.has_more || false;
                pageToken = resp.data.data?.page_token || "";
            }

            this._chatMembers = allMembers;
            this._membersCacheTime = now;
            return { success: true, count: Object.keys(allMembers).length, cached: false };
        } catch (e) {
            return { success: false, message: `加载群成员失败: ${e.message}` };
        }
    }

    getMemberName(memberId) {
        if (!memberId) return null;
        if (this._chatMembers[memberId]) return this._chatMembers[memberId];
        if (Object.keys(this._chatMembers).length === 0) {
            this.loadChatMembers().catch(() => {});
        }
        return null;
    }

    // ============================================================
    // 消息发送
    // ============================================================

    async sendMessage(text) {
        if (!this.isConfigured()) {
            return { success: false, message: "飞书未配置" };
        }
        const token = await this.getTenantAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const resp = await this.session.post(
                "/im/v1/messages?receive_id_type=chat_id",
                {
                    receive_id: this.chatId,
                    msg_type: "text",
                    content: JSON.stringify({ text }),
                },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            if (resp.data.code === 0) {
                return { success: true, message: "发送成功" };
            }
            return { success: false, message: resp.data.msg || `错误码: ${resp.data.code}` };
        } catch (e) {
            return { success: false, message: `发送失败: ${e.message}` };
        }
    }

    async replyMessage(messageId, text) {
        const token = await this.getTenantAccessToken();
        if (!token) return false;
        try {
            await this.session.post(
                `/im/v1/messages/reply`,
                {
                    msg_type: "text",
                    content: JSON.stringify({ text }),
                },
                {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { message_id: messageId },
                }
            );
            return true;
        } catch (e) {
            console.error("[Feishu] 回复消息失败:", e.message);
            return false;
        }
    }

    async uploadImage(imageBytes, filename = "image.png") {
        if (!this.isConfigured()) {
            return { success: false, message: "飞书未配置" };
        }
        const token = await this.getTenantAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const ext = filename.toLowerCase().split(".").pop() || "png";
            const contentTypeMap = {
                jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
                gif: "image/gif", webp: "image/webp",
            };
            const contentType = contentTypeMap[ext] || "image/png";

            const formData = new FormData();
            formData.append("image_type", "message");
            const blob = new Blob([imageBytes], { type: contentType });
            formData.append("image", blob, filename);

            const resp = await this.session.post("/im/v1/images", formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (resp.data.code === 0) {
                return { success: true, image_key: resp.data.data.image_key };
            }
            return { success: false, message: resp.data.msg || `错误码: ${resp.data.code}` };
        } catch (e) {
            return { success: false, message: `上传失败: ${e.message}` };
        }
    }

    async sendImageBytes(imageBytes, filename = "image.png", caption = null) {
        if (caption) {
            await this.sendMessage(caption);
        }
        const uploadResult = await this.uploadImage(imageBytes, filename);
        if (!uploadResult.success) return uploadResult;

        const token = await this.getTenantAccessToken();
        try {
            const resp = await this.session.post(
                "/im/v1/messages?receive_id_type=chat_id",
                {
                    receive_id: this.chatId,
                    msg_type: "image",
                    content: JSON.stringify({ image_key: uploadResult.image_key }),
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (resp.data.code === 0) {
                return { success: true, message: "图片发送成功" };
            }
            return { success: false, message: resp.data.msg || `错误码: ${resp.data.code}` };
        } catch (e) {
            return { success: false, message: `发送失败: ${e.message}` };
        }
    }

    // Webhook 简化发送
    async sendWebhookMessage(text) {
        if (!this.botWebhookUrl) return { success: false, message: "未配置 webhook" };
        try {
            await axios.post(this.botWebhookUrl, {
                msg_type: "text",
                content: { text },
            });
            return { success: true };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    // ============================================================
    // 回调处理
    // ============================================================

    _decrypt(encrypt) {
        if (!this.encryptKey) return encrypt;
        try {
            const key = crypto.createHash("sha256").update(this.encryptKey).digest();
            const iv = Buffer.alloc(16, 0);
            const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
            let decrypted = decipher.update(encrypt, "base64", "utf8");
            decrypted += decipher.final("utf8");
            return decrypted;
        } catch (e) {
            console.error("[Feishu] 解密消息失败:", e.message);
            return null;
        }
    }

    async handleCallback(reqBody) {
        if (reqBody.type === "url_verification") {
            return { challenge: reqBody.challenge };
        }

        if (this.verificationToken && reqBody.token !== this.verificationToken) {
            return { error: "verification failed" };
        }

        const event = reqBody.event;
        if (!event) return { error: "no event" };

        const message = event.message;
        if (!message) return { code: 0 };

        if (message.message_type === "text") {
            try {
                const content = JSON.parse(message.content);
                const text = content.text || "";
                const cleanText = text.replace(/@_user_\d+/g, "").trim();

                if (cleanText && this.onMessage) {
                    const reply = await this.onMessage(cleanText, {
                        platform: "feishu",
                        messageId: message.message_id,
                        chatId: message.chat_id,
                        chatType: message.chat_type,
                        senderId: event.sender?.sender_id?.open_id,
                    });
                    if (reply) {
                        await this.replyMessage(message.message_id, reply);
                    }
                }
            } catch (e) {
                console.error("[Feishu] 处理消息失败:", e.message);
            }
        }

        return { code: 0 };
    }

    // ============================================================
    // 群列表查询
    // ============================================================

    async getChatsList() {
        const token = await this.getTenantAccessToken();
        if (!token) return { success: false, message: "获取token失败" };
        try {
            const resp = await this.session.get("/im/v1/chats?page_size=50", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (resp.data.code === 0) {
                const items = resp.data.data?.items || [];
                const chats = items.map(c => ({ chat_id: c.chat_id, name: c.name }));
                return { success: true, chats };
            }
            return { success: false, message: resp.data.msg || `错误码: ${resp.data.code}` };
        } catch (e) {
            return { success: false, message: `获取群列表失败: ${e.message}` };
        }
    }
}

module.exports = FeishuBot;
