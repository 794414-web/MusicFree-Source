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

// 解析用户输入的歌单链接 / 歌单ID，返回 { source, id }，无法识别返回 null
// 支持常见国内平台：网易云(默认)、QQ音乐、酷狗、酷我、咪咕，均可映射到 GD 聚合音源
function parsePlaylistInput(text) {
    var s = String(text || "").trim();
    if (!s) return null;
    var source = null;
    var id = null;
    // 网易云：兼容 PC 分享(music.163.com/#/playlist?id=)、移动端(y.music.163.com/m/playlist?id=)、
    // 简洁链接(music.163.com/playlist?id= 或 /playlist/xxx)、纯数字ID
    var m = s.match(/(?:music\.163\.com|y\.music\.163\.com)[^#?\s]*(?:#\/)?playlist(?:\?[^\s]*?id=|\/)(\d+)/i);
    if (m) { source = "netease"; id = m[1]; }
    // QQ音乐：y.qq.com .../playlist/xxx 或 .../playlist?id=xxx
    if (!source) {
        var q = s.match(/y\.qq\.com[^\s]*?playlist(?:\/|(?:\?[^\s]*?id=))(\d+)/i);
        if (q) { source = "tencent"; id = q[1]; }
    }
    // QQ音乐分享页：i.y.qq.com/n2/m/share/details/taoge.html? ... id=xxx
    if (!source) {
        var q2 = s.match(/i\.y\.qq\.com[^\s]*?id=(\d+)/i);
        if (q2) { source = "tencent"; id = q2[1]; }
    }
    // 酷狗：kugou.com/yy/special/single/{id}
    if (!source) {
        var kg = s.match(/kugou\.com[^#\s]*special\/single\/([a-z0-9]+)/i);
        if (kg) { source = "kugou"; id = kg[1]; }
    }
    // 酷我：kuwo.cn/playlist_detail/{id}
    if (!source) {
        var kw = s.match(/kuwo\.cn[^#\s]*playlist[^\/]*\/(\d+)/i);
        if (kw) { source = "kuwo"; id = kw[1]; }
    }
    // 咪咕：music.migu.cn 歌单链接 m.migu.cn/playlist/{id}
    if (!source) {
        var mg = s.match(/migu\.cn[^#\s]*playlist[^\/]*\/(\d+)/i);
        if (mg) { source = "migu"; id = mg[1]; }
    }
    // 纯数字ID默认网易云歌单
    if (!source && /^\d+$/.test(s)) { source = "netease"; id = s; }
    if (!source || !id) return null;
    return { source: source, id: id };
}

// 将歌单接口返回的单曲格式化为 MusicFree 歌曲条目
// source 为发起歌单的音源，歌单内所有歌曲均按该音源取播放地址 / 歌词
function formatPlaylistTrack(track, source) {
    var trackId = String(track.id);
    var album = track.al || {};
    var picId = album.pic || album.picUrl || null;
    var artists = (track.ar || []).map(function (a) { return a.name; }).join(" / ");
    return {
        id: source + "-" + trackId,
        platform: "GD音乐台",
        title: track.name || "",
        artist: artists || "",
        album: album.name || "",
        _gdSource: source,
        _gdId: trackId,
        _gdPicId: picId,
        _gdLyricId: trackId,
    };
}

// 源记忆：曲目ID -> 上次成功播放的源
// 播放时优先使用上次成功的源，避免每次歌单都从默认（可能是失效的）源开始，节省切换时间
// 仅进程内生效，App 重启后回到默认源；换源成功后也会写回歌单条目（由 App 层持久化）
var SOURCE_MEMORY = {};

// 构建候选音源顺序：记忆源 -> 默认源 -> 其他稳定源
function buildSourceCandidates(musicItem) {
    var defaultSource = musicItem._gdSource || "netease";
    var id = String(musicItem._gdId || musicItem.id || "");
    var candidates = [];
    var remembered = id ? SOURCE_MEMORY[id] : null;
    if (remembered && remembered !== defaultSource) candidates.push(remembered);
    if (candidates.indexOf(defaultSource) === -1) candidates.push(defaultSource);
    STABLE_SOURCES.forEach(function (s) {
        if (candidates.indexOf(s) === -1) candidates.push(s);
    });
    return { candidates: candidates, id: id, defaultSource: defaultSource };
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
        importMusicSheet: [
            "目前可导入网易云歌单：粘贴歌单链接或歌单ID，纯数字ID 默认按网易云处理",
            "GD聚合接口暂未开放 QQ音乐 / 酷狗 / 酷我等歌单，这类链接可能返回空",
            "该接口有访问频率限制（5分钟内50次），请勿频繁导入",
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

    // 获取播放地址：优先记忆源 -> 默认源 -> 其他稳定源；每源内优先目标音质，失败降级 320
    // 成功后记录到源记忆，下次播放直接使用，避免每次歌单都从失效的默认源重新切换
    getMediaSource: function (musicItem, quality) {
        var srcInfo = buildSourceCandidates(musicItem);
        var brList = [QUALITY_BR[quality] || 320, 320];
        var candidateIdx = 0;
        var brIdx = 0;
        function nextCandidate() {
            if (candidateIdx >= srcInfo.candidates.length) {
                return Promise.resolve(null);
            }
            var source = srcInfo.candidates[candidateIdx];
            var id = musicItem._gdId || musicItem.id;
            if (brIdx >= brList.length) {
                candidateIdx += 1;
                brIdx = 0;
                return nextCandidate();
            }
            var br = brList[brIdx];
            brIdx += 1;
            return requestGD({
                types: "url",
                source: source,
                id: id,
                br: br,
            })
                .then(function (data) {
                    if (data && data.url) {
                        // 记录成功源，下次播放直接使用
                        if (srcInfo.id) SOURCE_MEMORY[srcInfo.id] = source;
                        return { url: data.url, _gdUsedSource: source };
                    }
                    return nextCandidate();
                })
                .catch(function () {
                    return nextCandidate();
                });
        }
        return nextCandidate();
    },

    // 获取歌词（含翻译）：依次尝试候选源（记忆源 -> 默认源 -> 其他稳定源），
    // 单个源歌词缺失/失败时降级到下一个源，提高歌词命中率
    getLyric: function (musicItem) {
        var srcInfo = buildSourceCandidates(musicItem);
        var id = musicItem._gdLyricId || musicItem._gdId || musicItem.id;
        var candidateIdx = 0;
        function nextCandidate() {
            if (candidateIdx >= srcInfo.candidates.length) {
                return Promise.resolve(null);
            }
            var source = srcInfo.candidates[candidateIdx];
            candidateIdx += 1;
            return requestGD({
                types: "lyric",
                source: source,
                id: id,
            })
                .then(function (data) {
                    if (data && data.lyric) {
                        return {
                            rawLrc: data.lyric,
                            translation: data.tlyric || undefined,
                        };
                    }
                    return nextCandidate();
                })
                .catch(function () {
                    return nextCandidate();
                });
        }
        return nextCandidate();
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

    // 导入歌单：解析链接/ID 后请求 GD 聚合歌单接口，返回歌曲列表
    // 返回 null 或空数组表示无法识别/歌单为空，由 App 提示
    importMusicSheet: function (urlLike) {
        var parsed = parsePlaylistInput(urlLike);
        if (!parsed) return Promise.resolve(null);
        return requestGD({
            types: "playlist",
            source: parsed.source,
            id: parsed.id,
            count: 50,
            pages: 1,
        })
            .then(function (data) {
                if (!data || !data.playlist || !Array.isArray(data.playlist.tracks)) {
                    return [];
                }
                return data.playlist.tracks
                    .map(function (track) {
                        return formatPlaylistTrack(track, parsed.source);
                    });
            })
            .catch(function () {
                return null;
            });
    },
};
