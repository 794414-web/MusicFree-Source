/**
 * MusicFree MCP Server 主入口
 * 集成：飞书机器人 + 企业微信机器人 + 小智 AI WebSocket + HTTP API
 * 
 * 参考 remote_watch_mcp 项目架构实现
 */

const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const MusicFreeClient = require("./musicfree-client");
const CommandParser = require("./command-parser");
const FeishuBot = require("./feishu-bot");
const WeComBot = require("./wecom-bot");
const XiaozhiClient = require("./xiaozhi-client");
const CarWsManager = require("./car-ws-manager");

// ============================================================
// 加载配置
// ============================================================
const configPath = path.join(__dirname, "config.json");
const exampleConfigPath = path.join(__dirname, "config.example.json");

if (!fs.existsSync(configPath)) {
    console.log("⚠️  未找到 config.json，正在从 config.example.json 复制...");
    fs.copyFileSync(exampleConfigPath, configPath);
    console.log("✅ 已创建 config.json，请根据需要修改配置后重新启动");
    process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ============================================================
// 初始化核心组件
// ============================================================
const carWsManager = new CarWsManager();

const musicfreeClient = new MusicFreeClient(
    {
        baseUrl: config.musicfree.baseUrl,
        accessToken: config.musicfree.accessToken,
    },
    carWsManager
);

const commandParser = new CommandParser(config.commands);

// ============================================================
// 统一消息处理函数
// ============================================================
async function handleMessage(text, context = {}) {
    const platform = context.platform || "unknown";
    console.log(`\n[${platform}] 收到消息: ${text}`);

    const parsed = commandParser.parse(text);
    console.log(`[解析] type=${parsed.type}, reply=${parsed.reply.substring(0, 50)}${parsed.reply.length > 50 ? "..." : ""}`);

    let reply = parsed.reply;

    try {
        switch (parsed.type) {
            case "help":
                // 解析器已返回帮助文本
                break;

            case "status": {
                const result = await musicfreeClient.getStatus();
                if (result.code === 0 && result.data) {
                    const d = result.data;
                    const current = d.currentMusic
                        ? `${d.currentMusic.title} - ${d.currentMusic.artist || "未知"}`
                        : "无";
                    const progress = d.progress && d.progress.duration > 0
                        ? `${formatTime(d.progress.position)} / ${formatTime(d.progress.duration)}`
                        : "-";
                    reply =
                        `🎵 播放器状态\n` +
                        `状态: ${d.isPlaying ? "▶ 播放中" : "⏸ 已暂停"}\n` +
                        `当前: ${current}\n` +
                        `进度: ${progress}\n` +
                        `列表: ${(d.playList || []).length} 首歌\n` +
                        `模式: ${d.repeatMode || "未知"}\n` +
                        `音量: ${Math.round((d.volume || 0) * 100)}%`;
                } else {
                    reply = `❌ 获取状态失败：${result.message || "未知错误"}`;
                }
                break;
            }

            case "play": {
                const result = await musicfreeClient.play();
                reply = result.code === 0 ? "✅ 继续播放" : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "pause": {
                const result = await musicfreeClient.pause();
                reply = result.code === 0 ? "✅ 已暂停播放" : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "next": {
                const result = await musicfreeClient.next();
                reply = result.code === 0 ? "✅ 已切换到下一首" : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "previous": {
                const result = await musicfreeClient.previous();
                reply = result.code === 0 ? "✅ 已切换到上一首" : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "volume_up": {
                const status = await musicfreeClient.getStatus();
                const currentVol = (status.data?.volume ?? 0.5);
                const newVol = Math.min(1, currentVol + 0.2);
                const result = await musicfreeClient.setVolume(newVol);
                reply = result.code === 0
                    ? `✅ 音量已调大到 ${Math.round(newVol * 100)}%`
                    : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "volume_down": {
                const status = await musicfreeClient.getStatus();
                const currentVol = (status.data?.volume ?? 0.5);
                const newVol = Math.max(0, currentVol - 0.2);
                const result = await musicfreeClient.setVolume(newVol);
                reply = result.code === 0
                    ? `✅ 音量已调小到 ${Math.round(newVol * 100)}%`
                    : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "volume_set": {
                const result = await musicfreeClient.setVolume(parsed.data);
                reply = result.code === 0
                    ? `✅ 音量已调到 ${Math.round(parsed.data * 100)}%`
                    : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "mute": {
                const result = await musicfreeClient.setVolume(0);
                reply = result.code === 0 ? "✅ 已静音" : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "unmute": {
                const result = await musicfreeClient.setVolume(0.5);
                reply = result.code === 0 ? "✅ 已恢复声音（音量 50%）" : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "repeat_mode": {
                const modeMap = {
                    shuffle: "随机播放",
                    single: "单曲循环",
                    list: "列表循环",
                    order: "顺序播放",
                };
                const result = await musicfreeClient.setRepeatMode(parsed.data);
                reply = result.code === 0
                    ? `✅ 已切换到${modeMap[parsed.data] || parsed.data}`
                    : `❌ ${result.message || "操作失败"}`;
                break;
            }

            case "search": {
                const result = await musicfreeClient.search(parsed.data);
                if (result.code === 0 && result.data) {
                    const results = result.data;
                    const count = results.reduce((sum, r) => sum + (r.results?.length || 0), 0);
                    reply = `搜索「${parsed.data}」共找到 ${count} 首歌`;
                    if (count > 0 && results[0]?.results?.[0]) {
                        const first = results[0].results[0];
                        reply += `\n推荐：${first.title} - ${first.artist || "未知"}`;
                    }
                } else {
                    reply = `❌ 搜索失败：${result.message || "未知错误"}`;
                }
                break;
            }

            case "play_search": {
                const result = await musicfreeClient.searchAndPlay(parsed.data);
                if (result.code === 0 && result.data) {
                    const music = result.data;
                    reply = `🎵 正在播放：${music.title} - ${music.artist || "未知"}`;
                    // 主动推送到飞书和企业微信（可选）
                    try {
                        if (feishuBot && config.feishu?.notifyOnPlay) {
                            feishuBot.sendTextToChat(
                                config.feishu.defaultChatId,
                                `🎵 车机正在播放：${music.title} - ${music.artist || "未知"}`
                            ).catch(e => console.error("[Feishu] 推送失败:", e.message));
                        }
                        if (wecomBot && config.wecom?.notifyOnPlay) {
                            wecomBot.sendText(
                                `🎵 车机正在播放：${music.title} - ${music.artist || "未知"}`
                            ).catch(e => console.error("[WeCom] 推送失败:", e.message));
                        }
                    } catch (_) { /* ignore */ }
                } else {
                    reply = `❌ ${result.message || "未找到相关歌曲"}`;
                }
                break;
            }

            case "unknown":
            default:
                break;
        }
    } catch (e) {
        console.error(`[${platform}] 执行命令失败:`, e.message);
        reply = `执行失败：${e.message}`;
    }

    console.log(`[${platform}] 回复: ${reply.substring(0, 100)}${reply.length > 100 ? "..." : ""}`);
    return reply;
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// ============================================================
// MCP 工具定义（供小智 AI 和标准 MCP 使用）
// ============================================================
function getMcpTools() {
    return [
        {
            name: "play_music",
            description: "搜索并播放指定歌曲。支持歌手、歌名或组合查询，如：周杰伦的稻香、稻香、周杰伦",
            inputSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "搜索词，例如：周杰伦的稻香、稻香、周杰伦",
                    },
                },
                required: ["query"],
            },
        },
        {
            name: "pause_music",
            description: "暂停当前播放的音乐",
        },
        {
            name: "resume_music",
            description: "继续播放当前暂停的音乐",
        },
        {
            name: "play_next",
            description: "切换到下一首歌曲",
        },
        {
            name: "play_previous",
            description: "切换到上一首歌曲",
        },
        {
            name: "set_volume",
            description: "设置播放器音量 (0-100)",
            inputSchema: {
                type: "object",
                properties: {
                    volume: {
                        type: "number",
                        minimum: 0,
                        maximum: 100,
                        description: "音量百分比，0 为静音，100 为最大音量",
                    },
                },
                required: ["volume"],
            },
        },
        {
            name: "mute",
            description: "静音（音量设为 0）",
        },
        {
            name: "unmute",
            description: "取消静音（恢复到 50% 音量）",
        },
        {
            name: "set_repeat_mode",
            description: "设置播放模式",
            inputSchema: {
                type: "object",
                properties: {
                    mode: {
                        type: "string",
                        enum: ["order", "list", "single", "shuffle"],
                        description: "播放模式：order 顺序，list 列表循环，single 单曲循环，shuffle 随机",
                    },
                },
                required: ["mode"],
            },
        },
        {
            name: "get_player_status",
            description: "获取播放器当前状态，包括播放状态、当前歌曲、播放列表、进度等",
        },
        {
            name: "send_command",
            description: "发送自然语言命令控制播放器",
            inputSchema: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "自然语言命令，如：播放周杰伦的稻香、暂停、下一首、音量调到50",
                    },
                },
                required: ["command"],
            },
        },
    ];
}

async function callMcpTool(name, args) {
    switch (name) {
        case "play_music": {
            const result = await musicfreeClient.searchAndPlay(args.query);
            if (result.code === 0 && result.data) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ 正在播放：${result.data.title} - ${result.data.artist || "未知"}`,
                        },
                    ],
                };
            }
            return {
                content: [{ type: "text", text: `❌ 播放失败：${result.message || "未找到歌曲"}` }],
                isError: true,
            };
        }

        case "pause_music": {
            const result = await musicfreeClient.pause();
            return {
                content: [{ type: "text", text: result.code === 0 ? "✅ 已暂停播放" : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "resume_music": {
            const result = await musicfreeClient.play();
            return {
                content: [{ type: "text", text: result.code === 0 ? "✅ 继续播放" : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "play_next": {
            const result = await musicfreeClient.next();
            return {
                content: [{ type: "text", text: result.code === 0 ? "✅ 已切换到下一首" : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "play_previous": {
            const result = await musicfreeClient.previous();
            return {
                content: [{ type: "text", text: result.code === 0 ? "✅ 已切换到上一首" : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "set_volume": {
            const vol = args.volume > 1 ? args.volume / 100 : args.volume;
            const result = await musicfreeClient.setVolume(vol);
            return {
                content: [{ type: "text", text: result.code === 0 ? `✅ 音量已调到 ${Math.round(vol * 100)}%` : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "mute": {
            const result = await musicfreeClient.setVolume(0);
            return {
                content: [{ type: "text", text: result.code === 0 ? "✅ 已静音" : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "unmute": {
            const result = await musicfreeClient.setVolume(0.5);
            return {
                content: [{ type: "text", text: result.code === 0 ? "✅ 已取消静音（音量 50%）" : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "set_repeat_mode": {
            const modeMap = { order: "顺序播放", list: "列表循环", single: "单曲循环", shuffle: "随机播放" };
            const result = await musicfreeClient.setRepeatMode(args.mode);
            return {
                content: [{ type: "text", text: result.code === 0 ? `✅ 已切换到${modeMap[args.mode] || args.mode}` : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "get_player_status": {
            const result = await musicfreeClient.getStatus();
            if (result.code === 0 && result.data) {
                const d = result.data;
                const current = d.currentMusic
                    ? `${d.currentMusic.title} - ${d.currentMusic.artist || "未知"}`
                    : "无";
                const progress = d.progress && d.progress.duration > 0
                    ? `${formatTime(d.progress.position)} / ${formatTime(d.progress.duration)}`
                    : "-";
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                `🎵 播放器状态\n` +
                                `状态: ${d.isPlaying ? "▶ 播放中" : "⏸ 已暂停"}\n` +
                                `当前: ${current}\n` +
                                `进度: ${progress}\n` +
                                `列表: ${(d.playList || []).length} 首歌\n` +
                                `模式: ${d.repeatMode || "未知"}\n` +
                                `音量: ${Math.round((d.volume || 0) * 100)}%`,
                        },
                    ],
                };
            }
            return {
                content: [{ type: "text", text: `❌ 获取状态失败：${result.message}` }],
                isError: true,
            };
        }

        case "send_command": {
            const reply = await handleMessage(args.command, { platform: "mcp" });
            return { content: [{ type: "text", text: reply }] };
        }

        default:
            return {
                content: [{ type: "text", text: `未知工具: ${name}` }],
                isError: true,
            };
    }
}

// ============================================================
// 初始化机器人和客户端
// ============================================================
let feishuBot = null;
let wecomBot = null;
let xiaozhiClient = null;

if (config.feishu?.enabled) {
    feishuBot = new FeishuBot(config.feishu, handleMessage);
    console.log("✅ 飞书机器人已启用");
    if (config.feishu.usePolling) {
        feishuBot.startPolling().catch(e => {
            console.error("[Feishu] 轮询启动失败:", e.message);
        });
    }
}

if (config.wecom?.enabled) {
    wecomBot = new WeComBot(config.wecom, handleMessage);
    console.log("✅ 企业微信机器人已启用");
}

if (config.xiaozhi?.enabled) {
    xiaozhiClient = new XiaozhiClient(config.xiaozhi, {
        getTools: getMcpTools,
        callTool: callMcpTool,
    });
    if (xiaozhiClient.isConfigured()) {
        console.log("✅ 小智 AI 客户端已启用");
        xiaozhiClient.connect().catch(e => {
            console.error("[Xiaozhi] 连接失败:", e.message);
        });
    } else {
        console.log("⚠️  小智 AI 未配置 wsUrl，跳过连接");
    }
}

// ============================================================
// Express + WebSocket 服务器
// ============================================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

// WebSocket 连接处理（车机连接）
wss.on("connection", (ws) => {
    console.log("🔌  收到 WebSocket 连接（/ws）");
    // 交给车机管理器
    carWsManager.registerCar(ws);
});

app.use(bodyParser.json({ type: "application/json" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text({ type: "text/xml" }));

// 健康检查
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "MusicFree MCP Server",
        version: "2.0.0",
        carConnected: carWsManager.hasCar(),
        carInfo: carWsManager.getCarInfo(),
        services: {
            feishu: config.feishu?.enabled ? "enabled" : "disabled",
            wecom: config.wecom?.enabled ? "enabled" : "disabled",
            xiaozhi: config.xiaozhi?.enabled ? (xiaozhiClient?.isConfigured() ? "connected" : "enabled (no wsUrl)") : "disabled",
        },
    });
});

// 直接 API 接口
app.get("/api/play-search", async (req, res) => {
    const query = req.query.q || req.query.query;
    if (!query) {
        return res.json({ code: -1, message: "请提供搜索词 q" });
    }
    const reply = await handleMessage(String(query), { platform: "api" });
    res.json({ code: 0, message: "ok", reply });
});

app.post("/api/send-command", async (req, res) => {
    const text = req.body.text || req.body.command;
    if (!text) {
        return res.json({ code: -1, message: "请提供命令 text" });
    }
    const reply = await handleMessage(String(text), { platform: "api" });
    res.json({ code: 0, message: "ok", reply });
});

// 飞书回调
app.post("/feishu/callback", async (req, res) => {
    if (!feishuBot) {
        return res.status(404).json({ error: "飞书机器人未启用" });
    }
    const result = await feishuBot.handleCallback(req.body);
    res.json(result || {});
});

// 企业微信回调 - URL 验证
app.get("/wecom/callback", (req, res) => {
    if (!wecomBot) {
        return res.status(404).send("企业微信机器人未启用");
    }
    const result = wecomBot.verifyURL(req.query);
    res.type("text/plain").send(result || "");
});

// 企业微信回调 - 消息接收
app.post("/wecom/callback", async (req, res) => {
    if (!wecomBot) {
        return res.status(404).send("企业微信机器人未启用");
    }
    const reply = await wecomBot.handleCallback(req.body, req.query);
    res.type("text/plain").send(reply || "");
});

// 小智 AI HTTP 回调（简化版，兼容旧接口）
app.post("/xiaozhi/callback", async (req, res) => {
    const { text, deviceId } = req.body || {};
    if (!text) {
        return res.json({ code: -1, message: "缺少 text 参数" });
    }
    const reply = await handleMessage(text, { platform: "xiaozhi_http", deviceId });
    res.json({ code: 0, reply });
});

// 网页配置面板 - 读取配置
app.get("/api/config", (req, res) => {
    const safeConfig = JSON.parse(JSON.stringify(config));
    // 脱敏：只显示最后几个字符
    if (safeConfig.feishu?.appSecret) {
        safeConfig.feishu.appSecret = "***" + safeConfig.feishu.appSecret.slice(-4);
    }
    if (safeConfig.wecom?.secret) {
        safeConfig.wecom.secret = "***" + safeConfig.wecom.secret.slice(-4);
    }
    if (safeConfig.wecom?.token) {
        safeConfig.wecom.token = "***" + safeConfig.wecom.token.slice(-4);
    }
    if (safeConfig.wecom?.encodingAESKey) {
        safeConfig.wecom.encodingAESKey = "***" + safeConfig.wecom.encodingAESKey.slice(-4);
    }
    if (safeConfig.xiaozhi?.wsUrl) {
        const parts = safeConfig.xiaozhi.wsUrl.split("token=");
        if (parts[1]) safeConfig.xiaozhi.wsUrl = parts[0] + "token=***" + parts[1].slice(-8);
    }
    res.json(safeConfig);
});

// 网页配置面板 - 保存配置
app.post("/api/config", bodyParser.json(), (req, res) => {
    try {
        const newConfig = req.body;
        // 只更新允许修改的字段，保留原始敏感值
        // （如果用户传的是 *** 开头的值，说明没改，保留原值）
        function mergeValue(oldVal, newVal, mask = true) {
            if (newVal === undefined) return oldVal;
            if (mask && typeof newVal === "string" && newVal.startsWith("***")) return oldVal;
            return newVal;
        }

        config.server.port = mergeValue(config.server?.port, newConfig.server?.port, false);
        config.server.host = mergeValue(config.server?.host, newConfig.server?.host, false);
        config.musicfree.baseUrl = mergeValue(config.musicfree?.baseUrl, newConfig.musicfree?.baseUrl, false);

        if (config.feishu && newConfig.feishu) {
            config.feishu.enabled = mergeValue(config.feishu.enabled, newConfig.feishu.enabled, false);
            config.feishu.appId = mergeValue(config.feishu.appId, newConfig.feishu.appId, false);
            config.feishu.appSecret = mergeValue(config.feishu.appSecret, newConfig.feishu.appSecret);
            config.feishu.defaultChatId = mergeValue(config.feishu.defaultChatId, newConfig.feishu.defaultChatId, false);
            config.feishu.usePolling = mergeValue(config.feishu.usePolling, newConfig.feishu.usePolling, false);
            config.feishu.notifyOnPlay = mergeValue(config.feishu.notifyOnPlay, newConfig.feishu.notifyOnPlay, false);
        }

        if (config.wecom && newConfig.wecom) {
            config.wecom.enabled = mergeValue(config.wecom.enabled, newConfig.wecom.enabled, false);
            config.wecom.corpId = mergeValue(config.wecom.corpId, newConfig.wecom.corpId, false);
            config.wecom.agentId = mergeValue(config.wecom.agentId, newConfig.wecom.agentId, false);
            config.wecom.secret = mergeValue(config.wecom.secret, newConfig.wecom.secret);
            config.wecom.token = mergeValue(config.wecom.token, newConfig.wecom.token);
            config.wecom.encodingAESKey = mergeValue(config.wecom.encodingAESKey, newConfig.wecom.encodingAESKey);
            config.wecom.receiveId = mergeValue(config.wecom.receiveId, newConfig.wecom.receiveId, false);
            config.wecom.notifyOnPlay = mergeValue(config.wecom.notifyOnPlay, newConfig.wecom.notifyOnPlay, false);
        }

        if (config.xiaozhi && newConfig.xiaozhi) {
            config.xiaozhi.enabled = mergeValue(config.xiaozhi.enabled, newConfig.xiaozhi.enabled, false);
            config.xiaozhi.wsUrl = mergeValue(config.xiaozhi.wsUrl, newConfig.xiaozhi.wsUrl);
            config.xiaozhi.autoReconnect = mergeValue(config.xiaozhi.autoReconnect, newConfig.xiaozhi.autoReconnect, false);
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
        res.json({ code: 0, message: "配置已保存，服务将自动重启以应用新配置" });
        // 3秒后重启服务
        setTimeout(() => {
            console.log("🔄 配置已更新，服务正在重启...");
            process.exit(0);
        }, 1500);
    } catch (e) {
        res.json({ code: -1, message: "保存失败：" + e.message });
    }
});

// 网页配置面板 - HTML
app.get("/", (req, res) => {
    res.type("text/html").send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MusicFree MCP 配置面板</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif; background: #f0f2f5; color: #333; padding: 20px; }
.container { max-width: 900px; margin: 0 auto; }
h1 { text-align: center; color: #1a73e8; margin-bottom: 8px; }
.subtitle { text-align: center; color: #666; margin-bottom: 24px; }
.card { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.card h2 { color: #1a73e8; margin-bottom: 16px; font-size: 18px; border-bottom: 2px solid #e8f0fe; padding-bottom: 8px; }
.form-row { display: flex; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.form-group { flex: 1; min-width: 200px; }
label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; font-weight: 500; }
input[type="text"], input[type="number"], input[type="url"], select {
    width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px;
    font-size: 14px; transition: border-color 0.2s;
}
input:focus, select:focus { outline: none; border-color: #1a73e8; }
.switch-row { display: flex; align-items: center; gap: 10px; }
.switch { position: relative; width: 44px; height: 24px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 24px; transition: 0.3s; }
.slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; }
input:checked + .slider { background: #1a73e8; }
input:checked + .slider:before { transform: translateX(20px); }
.btn { background: #1a73e8; color: white; border: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 500; transition: background 0.2s; }
.btn:hover { background: #1557b0; }
.btn-secondary { background: #f1f3f4; color: #333; margin-left: 12px; }
.btn-secondary:hover { background: #e8eaed; }
.status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; }
.status.ok { background: #e6f4ea; color: #137333; }
.status.warn { background: #fef7e0; color: #b06000; }
.status.err { background: #fce8e6; color: #c5221f; }
.hint { font-size: 12px; color: #999; margin-top: 4px; }
.toast { position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; color: white; font-weight: 500; z-index: 9999; animation: slideIn 0.3s; }
.toast.success { background: #137333; }
.toast.error { background: #c5221f; }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
</style>
</head>
<body>
<div class="container">
    <h1>🎵 MusicFree MCP 配置面板</h1>
    <p class="subtitle">配置飞书 / 企业微信 / 小智 AI 接入，控制车机音乐播放器</p>

    <div id="statusBar" class="card">
        <h2>📊 当前状态</h2>
        <div id="statusContent">加载中...</div>
    </div>

    <form id="configForm">
        <div class="card">
            <h2>🚗 车机连接</h2>
            <div class="form-row">
                <div class="form-group">
                    <label>车机 MCP 地址（可选 HTTP 模式）</label>
                    <input type="url" id="musicfree_baseUrl" placeholder="http://192.168.1.100:3688">
                    <div class="hint">车机 APP 启动后会通过 WebSocket 连回来，此地址可留空</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>🤖 小智 AI</h2>
            <div class="form-row">
                <div class="form-group switch-row">
                    <label class="switch"><input type="checkbox" id="xiaozhi_enabled"><span class="slider"></span></label>
                    <span>启用小智 AI</span>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex: 2;">
                    <label>WebSocket 接入地址</label>
                    <input type="text" id="xiaozhi_wsUrl" placeholder="wss://api.xiaozhi.me/mcp/?token=...">
                </div>
            </div>
        </div>

        <div class="card">
            <h2>💬 飞书机器人</h2>
            <div class="form-row">
                <div class="form-group switch-row">
                    <label class="switch"><input type="checkbox" id="feishu_enabled"><span class="slider"></span></label>
                    <span>启用飞书机器人</span>
                </div>
                <div class="form-group switch-row">
                    <label class="switch"><input type="checkbox" id="feishu_usePolling"><span class="slider"></span></label>
                    <span>消息轮询模式（无需公网，推荐）</span>
                </div>
                <div class="form-group switch-row">
                    <label class="switch"><input type="checkbox" id="feishu_notifyOnPlay"><span class="slider"></span></label>
                    <span>播放时推送通知</span>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>App ID</label>
                    <input type="text" id="feishu_appId" placeholder="cli_xxxxxxxx">
                </div>
                <div class="form-group">
                    <label>App Secret</label>
                    <input type="text" id="feishu_appSecret" placeholder="输入新的 Secret 才会更新">
                </div>
                <div class="form-group">
                    <label>默认群聊 ID</label>
                    <input type="text" id="feishu_defaultChatId" placeholder="oc_xxxxxxxx">
                </div>
            </div>
        </div>

        <div class="card">
            <h2>📱 企业微信机器人</h2>
            <div class="form-row">
                <div class="form-group switch-row">
                    <label class="switch"><input type="checkbox" id="wecom_enabled"><span class="slider"></span></label>
                    <span>启用企业微信机器人</span>
                </div>
                <div class="form-group switch-row">
                    <label class="switch"><input type="checkbox" id="wecom_notifyOnPlay"><span class="slider"></span></label>
                    <span>播放时推送通知</span>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>企业 ID (Corp ID)</label>
                    <input type="text" id="wecom_corpId" placeholder="wwxxxxxxxx">
                </div>
                <div class="form-group">
                    <label>Agent ID</label>
                    <input type="text" id="wecom_agentId" placeholder="1000002">
                </div>
                <div class="form-group">
                    <label>Secret</label>
                    <input type="text" id="wecom_secret" placeholder="输入新的 Secret 才会更新">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Token (回调校验)</label>
                    <input type="text" id="wecom_token" placeholder="输入新的 Token 才会更新">
                </div>
                <div class="form-group">
                    <label>EncodingAESKey (消息加解密)</label>
                    <input type="text" id="wecom_encodingAESKey" placeholder="输入新的 AES Key 才会更新">
                </div>
                <div class="form-group">
                    <label>接收人 ID (可选)</label>
                    <input type="text" id="wecom_receiveId" placeholder="用户ID或部门ID">
                </div>
            </div>
        </div>

        <div class="card" style="text-align: center;">
            <button type="submit" class="btn">💾 保存配置并重启服务</button>
            <button type="button" class="btn btn-secondary" onclick="loadConfig()">重置</button>
        </div>
    </form>
</div>

<script>
function $(id) { return document.getElementById(id); }

function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

async function loadStatus() {
    try {
        const r = await fetch('/health');
        const d = await r.json();
        const carStatus = d.carConnected
            ? '<span class="status ok">✅ 车机已连接</span>'
            : '<span class="status warn">⚠️ 等待车机连接</span>';
        const feishuStatus = d.services.feishu === 'enabled'
            ? '<span class="status ok">✅ 已启用</span>'
            : '<span class="status err">❌ 未启用</span>';
        const wecomStatus = d.services.wecom === 'enabled'
            ? '<span class="status ok">✅ 已启用</span>'
            : '<span class="status err">❌ 未启用</span>';
        const xiaozhiStatus = d.services.xiaozhi.includes('connected')
            ? '<span class="status ok">✅ 已连接</span>'
            : (d.services.xiaozhi.includes('enabled')
                ? '<span class="status warn">⚠️ 已启用（未连接）</span>'
                : '<span class="status err">❌ 未启用</span>');
        $('statusContent').innerHTML = \`
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                <div>🚗 车机连接：\${carStatus}</div>
                <div>🤖 小智 AI：\${xiaozhiStatus}</div>
                <div>💬 飞书：\${feishuStatus}</div>
                <div>📱 企业微信：\${wecomStatus}</div>
            </div>
        \`;
    } catch(e) {}
}

async function loadConfig() {
    try {
        const r = await fetch('/api/config');
        const c = await r.json();
        $('musicfree_baseUrl').value = c.musicfree?.baseUrl || '';
        $('xiaozhi_enabled').checked = c.xiaozhi?.enabled || false;
        $('xiaozhi_wsUrl').value = c.xiaozhi?.wsUrl || '';
        $('feishu_enabled').checked = c.feishu?.enabled || false;
        $('feishu_appId').value = c.feishu?.appId || '';
        $('feishu_appSecret').value = c.feishu?.appSecret || '';
        $('feishu_defaultChatId').value = c.feishu?.defaultChatId || '';
        $('feishu_usePolling').checked = c.feishu?.usePolling || false;
        $('feishu_notifyOnPlay').checked = c.feishu?.notifyOnPlay || false;
        $('wecom_enabled').checked = c.wecom?.enabled || false;
        $('wecom_corpId').value = c.wecom?.corpId || '';
        $('wecom_agentId').value = c.wecom?.agentId || '';
        $('wecom_secret').value = c.wecom?.secret || '';
        $('wecom_token').value = c.wecom?.token || '';
        $('wecom_encodingAESKey').value = c.wecom?.encodingAESKey || '';
        $('wecom_receiveId').value = c.wecom?.receiveId || '';
        $('wecom_notifyOnPlay').checked = c.wecom?.notifyOnPlay || false;
    } catch(e) { showToast('加载配置失败', 'error'); }
}

$('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
        musicfree: { baseUrl: $('musicfree_baseUrl').value },
        xiaozhi: {
            enabled: $('xiaozhi_enabled').checked,
            wsUrl: $('xiaozhi_wsUrl').value,
        },
        feishu: {
            enabled: $('feishu_enabled').checked,
            appId: $('feishu_appId').value,
            appSecret: $('feishu_appSecret').value,
            defaultChatId: $('feishu_defaultChatId').value,
            usePolling: $('feishu_usePolling').checked,
            notifyOnPlay: $('feishu_notifyOnPlay').checked,
        },
        wecom: {
            enabled: $('wecom_enabled').checked,
            corpId: $('wecom_corpId').value,
            agentId: $('wecom_agentId').value,
            secret: $('wecom_secret').value,
            token: $('wecom_token').value,
            encodingAESKey: $('wecom_encodingAESKey').value,
            receiveId: $('wecom_receiveId').value,
            notifyOnPlay: $('wecom_notifyOnPlay').checked,
        },
    };
    try {
        const r = await fetch('/api/config', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (d.code === 0) {
            showToast('配置已保存，服务正在重启...');
            setTimeout(() => location.reload(), 2500);
        } else {
            showToast(d.message || '保存失败', 'error');
        }
    } catch(e) { showToast('请求失败', 'error'); }
});

loadConfig();
loadStatus();
setInterval(loadStatus, 5000);
</script>
</body>
</html>
`);
});

// ============================================================
// 启动服务器
// ============================================================
const serverPort = config.server?.port || 3000;
const serverHost = config.server?.host || "0.0.0.0";

app.listen = function() { throw new Error("use server.listen instead"); }; // 防止误用

server.listen(serverPort, serverHost, () => {
    const carConnected = carWsManager.hasCar();
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║           🎵 MusicFree MCP Server v2.0                    ║");
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  服务地址:   http://${serverHost}:${serverPort}`);
    console.log(`  WebSocket:  ws://${require("os").hostname()}:${serverPort}/ws  (车机连接到此)`);
    console.log(`  车机模式:   ${carConnected ? "✅ WebSocket 已连接" : (config.musicfree.baseUrl ? `HTTP ${config.musicfree.baseUrl}` : "等待车机 WebSocket 连接...")}`);
    console.log("");
    console.log("  启用的服务:");
    if (config.feishu?.enabled) {
        console.log(`    ✅ 飞书机器人 ${config.feishu.usePolling ? "(消息轮询模式)" : "(回调模式)"}`);
    }
    if (config.wecom?.enabled) {
        console.log(`    ✅ 企业微信机器人`);
    }
    if (config.xiaozhi?.enabled && xiaozhiClient?.isConfigured()) {
        console.log(`    ✅ 小智 AI WebSocket (${config.xiaozhi.wsUrl.substring(0, 40)}...)`);
    }
    console.log("");
    console.log("  车机配置提示:");
    console.log(`    在车机 APP 中设置 MCP 地址为: ws://你电脑IP:${serverPort}/ws`);
    console.log(`    例如: ws://192.168.1.50:${serverPort}/ws`);
    console.log("");
    console.log("  可用接口:");
    console.log("    GET  /health               - 健康检查");
    console.log("    GET  /api/play-search?q=   - 搜索并播放");
    console.log("    POST /api/send-command     - 发送命令");
    if (config.feishu?.enabled) console.log("    POST /feishu/callback      - 飞书机器人回调");
    if (config.wecom?.enabled) console.log("    GET/POST /wecom/callback   - 企业微信机器人回调");
    console.log("");
    console.log("  支持的命令示例:");
    console.log("    · 播放周杰伦的稻香 / 放一首稻香");
    console.log("    · 暂停 / 继续播放");
    console.log("    · 下一首 / 上一首");
    console.log("    · 音量调到 50 / 大点声 / 小点声");
    console.log("    · 静音 / 取消静音");
    console.log("    · 随机播放 / 单曲循环 / 顺序播放");
    console.log("    · 现在放的什么歌 / 播放器状态");
    console.log("    · 帮助（查看所有指令）");
    console.log("");
});
