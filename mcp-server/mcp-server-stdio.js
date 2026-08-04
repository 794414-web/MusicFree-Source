#!/usr/bin/env node
/**
 * MusicFree MCP 服务器（标准 MCP 协议版）
 * 支持通过 MCP 协议直接被 AI 助手调用
 * 
 * 使用方式:
 *  1. 在 AI 助手中配置 MCP 服务器
 *  2. 命令: node mcp-server-stdio.js
 */

const MusicFreeClient = require("./musicfree-client");
const CommandParser = require("./command-parser");
const fs = require("fs");
const path = require("path");

// 加载配置
const configPath = path.join(__dirname, "config.json");
let config = null;

if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} else {
    // 使用默认配置
    config = {
        musicfree: {
            baseUrl: process.env.MUSICFREE_BASE_URL || "http://192.168.1.100:3688",
            accessToken: process.env.MUSICFREE_ACCESS_TOKEN || "",
        },
        commands: {},
    };
}

const musicfreeClient = new MusicFreeClient(
    config.musicfree.baseUrl,
    config.musicfree.accessToken
);

const commandParser = new CommandParser(config.commands);

// MCP 工具定义
const tools = [
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
        description: "设置播放器音量 (0-1)",
        inputSchema: {
            type: "object",
            properties: {
                volume: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                    description: "音量值，0 为静音，1 为最大音量",
                },
            },
            required: ["volume"],
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

// 工具实现
async function callTool(name, args) {
    switch (name) {
        case "play_music": {
            const result = await musicfreeClient.searchAndPlay(args.query);
            if (result.code === 0) {
                const music = result.data;
                return {
                    content: [
                        {
                            type: "text",
                            text: music
                                ? `✅ 正在播放：${music.title} - ${music.artist || "未知"}`
                                : `✅ 播放命令已发送`,
                        },
                    ],
                };
            }
            return {
                content: [{ type: "text", text: `❌ 播放失败：${result.message}` }],
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
            const result = await musicfreeClient.setVolume(args.volume);
            return {
                content: [{ type: "text", text: result.code === 0 ? `✅ 音量已调到 ${Math.round(args.volume * 100)}%` : `❌ ${result.message}` }],
                isError: result.code !== 0,
            };
        }

        case "get_player_status": {
            const result = await musicfreeClient.getStatus();
            if (result.code === 0) {
                const d = result.data;
                const current = d.currentMusic
                    ? `${d.currentMusic.title} - ${d.currentMusic.artist || "未知"}`
                    : "无";
                const progress = d.progress.duration > 0
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
                                `列表: ${d.playList.length} 首歌\n` +
                                `模式: ${d.repeatMode}\n` +
                                `音质: ${d.quality}`,
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
            const parsed = commandParser.parse(args.command);
            let resultText = parsed.reply;

            try {
                switch (parsed.type) {
                    case "play":
                        await musicfreeClient.play();
                        break;
                    case "pause":
                        await musicfreeClient.pause();
                        break;
                    case "next":
                        await musicfreeClient.next();
                        break;
                    case "previous":
                        await musicfreeClient.previous();
                        break;
                    case "volume_set":
                        await musicfreeClient.setVolume(parsed.data);
                        break;
                    case "play_search": {
                        const r = await musicfreeClient.searchAndPlay(parsed.data);
                        if (r.code === 0 && r.data) {
                            resultText = `🎵 正在播放：${r.data.title} - ${r.data.artist || "未知"}`;
                        } else {
                            resultText = `❌ ${r.message || "播放失败"}`;
                        }
                        break;
                    }
                    default:
                        break;
                }
            } catch (e) {
                resultText = `执行失败：${e.message}`;
            }

            return {
                content: [{ type: "text", text: resultText }],
            };
        }

        default:
            return {
                content: [{ type: "text", text: `未知工具: ${name}` }],
                isError: true,
            };
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// MCP 协议处理
let requestId = 0;

function sendMessage(msg) {
    const json = JSON.stringify(msg);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n${json}`);
}

function sendResponse(id, result) {
    sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, error) {
    sendMessage({ jsonrpc: "2.0", id, error: { code: -32000, message: error } });
}

let buffer = "";

process.stdin.on("data", (data) => {
    buffer += data.toString();

    while (true) {
        // 解析 Content-Length
        const lengthMatch = buffer.match(/Content-Length: (\d+)\r\n\r\n/);
        if (!lengthMatch) break;

        const headerLength = lengthMatch.index + lengthMatch[0].length;
        const contentLength = parseInt(lengthMatch[1], 10);

        if (buffer.length < headerLength + contentLength) break;

        const content = buffer.slice(headerLength, headerLength + contentLength);
        buffer = buffer.slice(headerLength + contentLength);

        handleRequest(content);
    }
});

async function handleRequest(rawContent) {
    try {
        const msg = JSON.parse(rawContent);

        switch (msg.method) {
            case "initialize":
                sendResponse(msg.id, {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "musicfree-mcp-server", version: "1.0.0" },
                });
                break;

            case "notifications/initialized":
                // 初始化完成
                break;

            case "tools/list":
                sendResponse(msg.id, { tools });
                break;

            case "tools/call": {
                const { name, arguments: args } = msg.params;
                try {
                    const result = await callTool(name, args || {});
                    sendResponse(msg.id, result);
                } catch (e) {
                    sendError(msg.id, e.message);
                }
                break;
            }

            default:
                if (msg.id !== undefined) {
                    sendError(msg.id, `未知方法: ${msg.method}`);
                }
        }
    } catch (e) {
        console.error("处理请求失败:", e);
    }
}

// 错误处理
process.stdin.on("error", (e) => {
    console.error("STDIN 错误:", e);
});

process.stdout.on("error", (e) => {
    console.error("STDOUT 错误:", e);
});
