/**
 * 企业微信（WeCom）自建应用客户端
 * 参考 remote_watch_mcp 项目的 wework_client.py 实现
 * 支持：token 自动刷新、消息加解密、群聊/单聊、图片发送、消息去重
 */

const axios = require("axios");
const crypto = require("crypto");

class WeComBot {
    constructor(config, onMessage) {
        this.corpId = (config.corpId || "").trim();
        this.agentId = String(config.agentId || "").trim();
        this.secret = (config.secret || "").trim();
        this.token = (config.token || "").trim();
        this.encodingAESKey = (config.encodingAESKey || "").trim();
        this.receiveId = (config.receiveId || "").trim();
        this.chatId = (config.chatId || "").trim();
        this.onMessage = onMessage;

        this.accessToken = "";
        this.tokenExpireTime = 0;

        // 消息去重
        this._processedMsgIds = new Set();

        this.session = axios.create({
            baseURL: "https://qyapi.weixin.qq.com/cgi-bin",
            timeout: 15000,
            headers: {
                "User-Agent": "MusicFreeMCP/1.0",
            },
        });
    }

    isConfigured() {
        return !!(this.corpId && this.agentId && this.secret);
    }

    canReceive() {
        return this.isConfigured() && !!(this.token && this.encodingAESKey);
    }

    // ============================================================
    // Token 管理
    // ============================================================

    async getAccessToken() {
        const now = Date.now();
        if (this.accessToken && now < this.tokenExpireTime - 120000) {
            return this.accessToken;
        }

        if (!this.corpId || !this.secret) {
            return null;
        }

        try {
            const resp = await this.session.get("/gettoken", {
                params: { corpid: this.corpId, corpsecret: this.secret },
            });

            if (resp.data.errcode === 0) {
                this.accessToken = resp.data.access_token;
                this.tokenExpireTime = now + resp.data.expires_in * 1000;
                return this.accessToken;
            }
            const maskedId = this.corpId.length > 6
                ? this.corpId.slice(0, 4) + "****"
                : "***";
            console.error(
                `[Wework] 获取token失败: code=${resp.data.errcode}, msg=${resp.data.errmsg}`
            );
            console.error(`[Wework]   corp_id=${maskedId}`);
            return null;
        } catch (e) {
            console.error("[Wework] 获取token异常:", e.message);
            return null;
        }
    }

    // ============================================================
    // 消息加解密（参考官方 WXBizMsgCrypt）
    // ============================================================

    _pkcs7Decode(text) {
        const pad = text[text.length - 1];
        if (pad < 1 || pad > 32) return text;
        return text.slice(0, -pad);
    }

    _pkcs7Encode(text) {
        const textLength = text.length;
        let amountToPad = 32 - (textLength % 32);
        if (amountToPad === 0) amountToPad = 32;
        const pad = Buffer.alloc(amountToPad, amountToPad);
        return Buffer.concat([Buffer.isBuffer(text) ? text : Buffer.from(text), pad]);
    }

    _decryptMessage(encryptMsg) {
        if (!this.encodingAESKey) return null;
        try {
            const key = Buffer.from(this.encodingAESKey + "=", "base64");
            const iv = key.slice(0, 16);
            const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
            decipher.setAutoPadding(false);
            let decrypted = decipher.update(encryptMsg, "base64");
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            decrypted = this._pkcs7Decode(decrypted);

            const content = decrypted.slice(16);
            const msgLen = content.readUInt32BE(0);
            const xmlContent = content.slice(4, 4 + msgLen).toString("utf8");
            return xmlContent;
        } catch (e) {
            console.error("[Wework] 解密消息失败:", e.message);
            return null;
        }
    }

    _encryptMessage(xmlContent) {
        if (!this.encodingAESKey) return null;
        try {
            const key = Buffer.from(this.encodingAESKey + "=", "base64");
            const iv = key.slice(0, 16);
            const receiveId = this.receiveId || this.corpId || "";
            const contentBuf = Buffer.from(xmlContent);
            const randStr = crypto.randomBytes(16);
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeUInt32BE(contentBuf.length, 0);
            const fullBuf = Buffer.concat([
                randStr, lenBuf, contentBuf, Buffer.from(receiveId),
            ]);
            const padded = this._pkcs7Encode(fullBuf);
            const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
            cipher.setAutoPadding(false);
            let encrypted = cipher.update(padded);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            return encrypted.toString("base64");
        } catch (e) {
            console.error("[Wework] 加密消息失败:", e.message);
            return null;
        }
    }

    _generateSignature(timestamp, nonce, encrypt) {
        const list = [this.token || "", timestamp || "", nonce || "", encrypt || ""].sort();
        return crypto.createHash("sha1").update(list.join("")).digest("hex");
    }

    // ============================================================
    // 回调验证与消息处理
    // ============================================================

    verifyURL(params) {
        const { msg_signature, timestamp, nonce, echostr } = params;
        if (!this.token || !this.encodingAESKey) {
            return echostr || null;
        }

        const signature = this._generateSignature(timestamp, nonce, echostr);
        if (signature !== msg_signature) {
            console.error("[Wework] 回调验证签名不匹配");
            return null;
        }

        try {
            const key = Buffer.from(this.encodingAESKey + "=", "base64");
            const iv = key.slice(0, 16);
            const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
            decipher.setAutoPadding(false);
            let decrypted = decipher.update(echostr, "base64");
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            decrypted = this._pkcs7Decode(decrypted);
            const content = decrypted.slice(16);
            const msgLen = content.readUInt32BE(0);
            return content.slice(4, 4 + msgLen).toString("utf8");
        } catch (e) {
            console.error("[Wework] 解密 echostr 失败:", e.message);
            return null;
        }
    }

    _parseXML(xmlContent) {
        const result = {};
        const matches = xmlContent.match(/<(\w+)>([^<]*)<\/\1>/g) || [];
        matches.forEach(m => {
            const match = m.match(/<(\w+)>([^<]*)<\/\1>/);
            if (match) result[match[1]] = match[2];
        });
        return result;
    }

    async handleCallback(reqBody, queryParams) {
        // URL 验证（GET 请求）
        if (queryParams && queryParams.echostr) {
            const replyEcho = this.verifyURL(queryParams);
            return replyEcho || "error";
        }

        try {
            // 处理 POST 消息
            let messageContent;

            // 判断是 XML 字符串还是对象
            if (typeof reqBody === "string") {
                messageContent = this._parseXML(reqBody);
            } else {
                messageContent = reqBody;
            }

            // 如果是加密的，需要解密
            if (messageContent.Encrypt) {
                const xmlContent = this._decryptMessage(messageContent.Encrypt);
                if (!xmlContent) return "error";
                messageContent = this._parseXML(xmlContent);
            }

            const msgId = messageContent.MsgId;
            if (msgId && this._processedMsgIds.has(msgId)) {
                return "success";
            }
            if (msgId) this._processedMsgIds.add(msgId);

            const msgType = messageContent.MsgType;

            if (msgType === "text") {
                const text = messageContent.Content || "";
                const fromUser = messageContent.FromUserName;
                const chatId = messageContent.ChatId || this.chatId;

                if (text && this.onMessage) {
                    const reply = await this.onMessage(text.trim(), {
                        platform: "wecom",
                        fromUser,
                        toUser: messageContent.ToUserName,
                        msgId,
                        agentId: messageContent.AgentID,
                        chatId,
                    });

                    if (reply) {
                        if (fromUser) {
                            await this.sendMessage(reply, { toUser: fromUser });
                        } else if (chatId) {
                            await this.sendMessage(reply, { chatId });
                        }
                    }
                }
            }

            return "success";
        } catch (e) {
            console.error("[Wework] 处理回调失败:", e.message);
            return "error";
        }
    }

    // ============================================================
    // 消息发送
    // ============================================================

    async sendMessage(text, options = {}) {
        if (!this.isConfigured()) {
            return { success: false, message: "企业微信未配置" };
        }
        const token = await this.getAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const body = {
                msgtype: "text",
                agentid: parseInt(this.agentId),
                text: { content: text },
                safe: 0,
            };

            if (options.toUser) {
                body.touser = options.toUser;
            } else if (options.chatId) {
                body.chatid = options.chatId;
            } else if (options.toParty) {
                body.toparty = options.toParty;
            } else if (options.toTag) {
                body.totag = options.toTag;
            } else if (this.chatId) {
                body.chatid = this.chatId;
            }

            const resp = await this.session.post("/message/send", body, {
                params: { access_token: token },
            });

            if (resp.data.errcode === 0) {
                return { success: true, message: "发送成功" };
            }
            return { success: false, message: resp.data.errmsg || `错误码: ${resp.data.errcode}` };
        } catch (e) {
            return { success: false, message: `发送失败: ${e.message}` };
        }
    }

    async uploadMedia(mediaBytes, filename = "image.png", mediaType = "image") {
        if (!this.isConfigured()) {
            return { success: false, message: "企业微信未配置" };
        }
        const token = await this.getAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const ext = filename.toLowerCase().split(".").pop() || "png";
            const contentTypeMap = {
                jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
                gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
                mp3: "audio/mpeg", amr: "audio/amr",
            };
            const contentType = contentTypeMap[ext] || "application/octet-stream";

            const formData = new FormData();
            const blob = new Blob([mediaBytes], { type: contentType });
            formData.append("media", blob, filename);

            const resp = await this.session.post("/media/upload", formData, {
                params: { access_token: token, type: mediaType },
            });

            if (resp.data.errcode === 0) {
                return { success: true, media_id: resp.data.media_id, type: resp.data.type };
            }
            return { success: false, message: resp.data.errmsg || `错误码: ${resp.data.errcode}` };
        } catch (e) {
            return { success: false, message: `上传失败: ${e.message}` };
        }
    }

    async sendImageBytes(imageBytes, filename = "image.png", caption = null, options = {}) {
        if (caption) {
            await this.sendMessage(caption, options);
        }
        const uploadResult = await this.uploadMedia(imageBytes, filename, "image");
        if (!uploadResult.success) return uploadResult;

        if (!this.isConfigured()) {
            return { success: false, message: "企业微信未配置" };
        }
        const token = await this.getAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const body = {
                msgtype: "image",
                agentid: parseInt(this.agentId),
                image: { media_id: uploadResult.media_id },
                safe: 0,
            };

            if (options.toUser) body.touser = options.toUser;
            else if (options.chatId) body.chatid = options.chatId;
            else if (this.chatId) body.chatid = this.chatId;

            const resp = await this.session.post("/message/send", body, {
                params: { access_token: token },
            });
            if (resp.data.errcode === 0) {
                return { success: true, message: "图片发送成功" };
            }
            return { success: false, message: resp.data.errmsg || `错误码: ${resp.data.errcode}` };
        } catch (e) {
            return { success: false, message: `发送失败: ${e.message}` };
        }
    }

    // ============================================================
    // 群聊列表
    // ============================================================

    async getAppChatList() {
        if (!this.isConfigured()) {
            return { success: false, message: "企业微信未配置" };
        }
        const token = await this.getAccessToken();
        if (!token) return { success: false, message: "获取token失败" };

        try {
            const resp = await this.session.get("/appchat/list", {
                params: { access_token: token },
            });
            if (resp.data.errcode === 0) {
                const chats = resp.data.chat_list || [];
                return {
                    success: true,
                    chats: chats.map(c => ({ chat_id: c.chatid, name: c.name })),
                };
            }
            return { success: false, message: resp.data.errmsg || `错误码: ${resp.data.errcode}` };
        } catch (e) {
            return { success: false, message: `获取群列表失败: ${e.message}` };
        }
    }
}

module.exports = WeComBot;
