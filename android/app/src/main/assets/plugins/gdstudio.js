"use strict";

/**
 * GD音乐台（music.gdstudio.xyz）音乐源插件
 *
 * 直接对接 GD Studio 的公开聚合 API（基于 Meting），
 * 聚合搜索网易云 / JOOX / B站 等稳定源，无需各自平台的私密接口。
 *
 * 接口：
 *   https://music-api.gdstudio.xyz/api.php
 *   - types=search&source=&name=&count=&pages=   搜索，返回 id/name/artist/album/pic_id/lyric_id/source
 *   - types=url&source=&id=&br=                 获取播放地址，返回 { url, br, size }
 *   - types=lyric&source=&id=                   获取歌词，返回 { lyric, tlyric }
 *   - types=pic&source=&id=&size=               获取封面，返回 { url }
 *
 * 注意：插件沙箱为 Hermes 直接编译，不支持 async/await，故全部使用 Promise 链写法；
 *       该接口有访问频率限制（5分钟内不超过50次），故搜索时仅聚合稳定源，
 *       且失败时静默降级，保证其他音源不受影响。
 */

const axios = require("axios");

const BASE_URL = "https://music-api.gdstudio.xyz/api.php";

// GD 接口响应较慢，显式覆盖插件级默认 2000ms 超时，避免请求被过早中断
const REQUEST_TIMEOUT = 15000;

// 稳定音乐源（GD音乐台 2026-06-26 动态更新：netease / joox / bilibili）
const STABLE_SOURCES = ["netease", "joox", "bilibili"];

// MusicFree 音质 -> GD br 映射
// 740 为 16bit 无损，比 999(24bit) 文件更小更稳；super 播不出时 getMediaSource 会自动降级 320
const QUALITY_BR = {
    low: 128,
    standard: 320,
    high: 320,
    super: 740,
};

function requestGD(params) {
    return axios
        .get(BASE_URL, { params: params, timeout: REQUEST_TIMEOUT })
        .then(function (res) {
            return res.data;
        });
}

function formatSearchItem(item) {
    const source = item.source || "netease";
    const trackId = String(item.id);
    return {
        // 不同音乐源的 track_id 可能冲突，拼上 source 前缀保证全局唯一
        id: source + "-" + trackId,
        platform: "GD音乐台",
        title: item.name || "",
        artist: Array.isArray(item.artist)
            ? item.artist.join(" / ")
            : item.artist || "",
        album: item.album || "",
        // GD 私有字段，供 getMediaSource / getLyric / getMusicInfo 使用
        _gdSource: source,
        _gdId: trackId,
        _gdPicId: item.pic_id,
        _gdLyricId: item.lyric_id || trackId,
    };
}

// 单个音源搜索，失败静默降级为空数组
function searchOneSource(source, query, page) {
    return requestGD({
        types: "search",
        source: source,
        name: query,
        count: 20,
        pages: page,
    })
        .then(function (data) {
            return Array.isArray(data) ? data : [];
        })
        .catch(function () {
            return [];
        });
}

module.exports = {
    platform: "GD音乐台",
    author: "GD Studio",
    version: "1.0.0",
    srcUrl: BASE_URL,
    cacheControl: "no-cache",
    supportedSearchType: ["music"],
    primaryKey: ["id"],
    hints: {
        search: [
            "音源由 GD音乐台(music.gdstudio.xyz) 聚合 API 提供，仅限学习交流使用",
            "一次搜索聚合 网易云 / JOOX / B站 等稳定源结果",
            "该接口有访问频率限制（5分钟内50次），请勿频繁搜索",
        ],
    },

    // 搜索：并发请求多个稳定源并聚合
    search: function (query, page, type) {
        if (type !== "music") {
            return Promise.resolve({ isEnd: true, data: [] });
        }
        const tasks = STABLE_SOURCES.map(function (source) {
            return searchOneSource(source, query, page);
        });
        return Promise.all(tasks).then(function (results) {
            let list = [];
            results.forEach(function (arr) {
                list = list.concat(arr);
            });
            return {
                isEnd: true,
                data: list.map(formatSearchItem),
            };
        });
    },

    // 获取播放地址：优先目标音质，失败自动降级到 320
    getMediaSource: function (musicItem, quality) {
        const source = musicItem._gdSource || "netease";
        const id = musicItem._gdId || musicItem.id;
        const brList = [QUALITY_BR[quality] || 320, 320];
        let idx = 0;
        function tryBr() {
            if (idx >= brList.length) {
                return Promise.resolve(null);
            }
            const br = brList[idx];
            idx += 1;
            return requestGD({
                types: "url",
                source: source,
                id: id,
                br: br,
            })
                .then(function (data) {
                    if (data && data.url) {
                        return { url: data.url };
                    }
                    return tryBr();
                })
                .catch(function () {
                    return tryBr();
                });
        }
        return tryBr();
    },

    // 获取歌词（含翻译）
    getLyric: function (musicItem) {
        const source = musicItem._gdSource || "netease";
        const id = musicItem._gdLyricId || musicItem._gdId || musicItem.id;
        return requestGD({
            types: "lyric",
            source: source,
            id: id,
        })
            .then(function (data) {
                if (!data || !data.lyric) {
                    return null;
                }
                return {
                    rawLrc: data.lyric,
                    translation: data.tlyric || undefined,
                };
            })
            .catch(function () {
                return null;
            });
    },

    // 播放成功后补充封面图（列表封面不逐个请求，避免快速消耗接口频率额度）
    getMusicInfo: function (musicItem) {
        const source = musicItem._gdSource || "netease";
        const picId = musicItem._gdPicId;
        if (!picId) {
            return Promise.resolve(null);
        }
        return requestGD({
            types: "pic",
            source: source,
            id: picId,
            size: 300,
        })
            .then(function (data) {
                if (data && data.url) {
                    return { artwork: data.url };
                }
                return null;
            })
            .catch(function () {
                return null;
            });
    },
};
