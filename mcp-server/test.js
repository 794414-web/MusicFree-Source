/**
 * 快速测试脚本
 * 用于测试 MusicFree 车机连接和命令解析
 */

const MusicFreeClient = require("./musicfree-client");
const CommandParser = require("./command-parser");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "config.json");

async function main() {
    console.log("================================================");
    console.log("  MusicFree MCP Server - 快速测试");
    console.log("================================================");
    console.log("");

    if (!fs.existsSync(configPath)) {
        console.log("❌ 未找到 config.json，请先启动一次主程序自动生成");
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    // 1. 测试命令解析
    console.log("📝 测试命令解析器...");
    const parser = new CommandParser(config.commands);

    const testCases = [
        "播放周杰伦的稻香",
        "放一首稻香",
        "来一首周杰伦的歌",
        "我想听稻香",
        "暂停",
        "继续播放",
        "下一首",
        "上一首",
        "声音大点",
        "小点声",
        "音量调到50",
        "搜索稻香",
        "稻香",
        "周杰伦",
    ];

    for (const testCase of testCases) {
        const result = parser.parse(testCase);
        const status = result.type !== "unknown" ? "✅" : "❓";
        console.log(`  ${status} "${testCase}" → type=${result.type}${result.data ? `, data=${JSON.stringify(result.data)}` : ""}`);
    }

    console.log("");

    // 2. 测试车机连接
    console.log("🚗 测试车机连接...");
    console.log(`  车机地址: ${config.musicfree.baseUrl}`);

    const client = new MusicFreeClient(
        config.musicfree.baseUrl,
        config.musicfree.accessToken
    );

    try {
        const status = await client.getStatus();
        if (status.code === 0) {
            console.log("  ✅ 车机连接成功!");
            console.log(`     当前状态: ${status.data.isPlaying ? "播放中" : "已暂停"}`);
            if (status.data.currentMusic) {
                console.log(`     当前歌曲: ${status.data.currentMusic.title} - ${status.data.currentMusic.artist || "未知"}`);
            }
            console.log(`     播放列表: ${status.data.playList.length} 首`);
        } else {
            console.log(`  ❌ 车机连接失败: ${status.message}`);
            console.log("     请检查:");
            console.log("     1. 车机 MusicFree 是否启动");
            console.log("     2. 远程控制服务是否开启（设置 → 基础设置 → 远程控制）");
            console.log(`     3. 车机 IP 地址是否正确（当前: ${config.musicfree.baseUrl}）`);
            console.log("     4. 电脑和车机是否在同一局域网");
        }
    } catch (e) {
        console.log(`  ❌ 连接异常: ${e.message}`);
    }

    console.log("");
    console.log("================================================");
    console.log("  测试完成!");
    console.log("================================================");
}

main().catch(console.error);
