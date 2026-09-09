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
    var source = item.source || "netease";
    var trackId = String(item.id);
    var artists = Array.isArray(item.artist)
        ? item.artist.join(" / ")
        : item.artist || "";
    var album = item.album;
    if (album && typeof album === "object") album = album.name || "";
    return {
        id: source + "-" + trackId,
        platform: "GD音乐台",
        title: item.name || item.title || "",
        artist: artists,
        album: album || "",
        duration: item.duration || item.dt || item.interval || undefined,
        artwork: item.pic || item.picUrl || undefined,
        _gdSource: source,
        _gdId: trackId,
        _gdPicId: item.pic_id || item.picId,
        _gdLyricId: item.lyric_id || item.lyricId || trackId,
    };
}

// ===== 匹配辅助 =====
// 常用繁体字 -> 简体映射（覆盖歌名/歌手常见字，用于归一化匹配）
var TRAD_TO_SIMPLE = {
    "倫":"伦","傑":"杰","葉":"叶","黃":"黄","陳":"陈","張":"张","劉":"刘","楊":"杨",
    "吳":"吴","鄭":"郑","馬":"马","謝":"谢","蘇":"苏","許":"许","趙":"赵","錢":"钱",
    "孫":"孙","萬":"万","軍":"军","國":"国","華":"华","漢":"汉","愛":"爱","會":"会",
    "還":"还","這":"这","個":"个","們":"们","來":"来","為":"为","麼":"么","說":"说",
    "時":"时","間":"间","點":"点","龍":"龙","鳳":"凤","夢":"梦","獨":"独","潔":"洁",
    "純":"纯","靜":"静","樂":"乐","館":"馆","觀":"观","歡":"欢","發":"发","長":"长",
    "門":"门","問":"问","開":"开","關":"关","對":"对","錯":"错","過":"过","遠":"远",
    "邊":"边","讓":"让","請":"请","詩":"诗","詞":"词","語":"语","話":"话","讀":"读",
    "寫":"写","學":"学","習":"习","書":"书","畫":"画","紙":"纸","筆":"笔","電":"电",
    "腦":"脑","機":"机","車":"车","輪":"轮","飛":"飞","風":"风","雲":"云","興":"兴",
    "東":"东","頭":"头","兒":"儿","轉":"转","歷":"历","單":"单","雙":"双","聲":"声",
    "聽":"听","歸":"归","舊":"旧","廣":"广","園":"园","燈":"灯","號":"号","線":"线",
    "紅":"红","綠":"绿","藍":"蓝","銀":"银","鋼":"钢","錄":"录","簡":"简","編":"编",
    "維":"维","結":"结","網":"网","組":"组","總":"总","經":"经","絕":"绝","續":"续",
    "繼":"继","約":"约","級":"级","紀":"纪","繞":"绕","緣":"缘","縮":"缩","議":"议",
    "譯":"译","護":"护","買":"买","賣":"卖","贊":"赞","貝":"贝","貴":"贵","賓":"宾",
    "賬":"账","贈":"赠","質":"质","賭":"赌","贏":"赢","賢":"贤","賴":"赖","趣":"趣",
    "躍":"跃","認":"认","誤":"误","誘":"诱","謊":"谎","謙":"谦","證":"证","譚":"谭",
    "譜":"谱","響":"响","項":"项","順":"顺","須":"须","預":"预","頑":"顽","顧":"顾",
    "顫":"颤","顯":"显","驗":"验","驚":"惊","騙":"骗","體":"体","髮":"发","鬍":"胡",
    "魚":"鱼","魯":"鲁","鯊":"鲨","鯨":"鲸","鳥":"鸟","鴨":"鸭","鶯":"莺","鶴":"鹤",
    "麥":"麦","麻":"麻","黑":"黑","齊":"齐","齒":"齿","齣":"出","龜":"龟","鼓":"鼓",
    "臺":"台","颱":"台","鵬":"鹏","鷹":"鹰","麗":"丽","麋":"麋",
};

// 繁体转简体（仅处理映射表覆盖的常用字）
function toSimplified(str) {
    var s = String(str || "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        out += TRAD_TO_SIMPLE[ch] || ch;
    }
    return out;
}

// 归一化：繁体转简体、去空白、去括号及括号内容、转小写、去除常见标点
// 用于「歌名 + 歌手」匹配，忽略繁简体/空格/括号注释差异，提高命中原唱概率
function normText(str) {
    return toSimplified(String(str || ""))
        .toLowerCase()
        .replace(/[\s\u3000]/g, "")
        .replace(/[（(【\[][\s\S]*?[）)】\]]/g, "")
        .replace(/[，。、；：！？!?·,.'"“”‘’\-—~：]/g, "");
}

// 格式化条目歌手（数组 -> 字符串）
function artistText(item) {
    return Array.isArray(item.artist)
        ? item.artist.join("/")
        : String(item.artist || "");
}

// 翻唱/伴奏/纯音乐/现场版等"非原唱版本"特征词（命中任一条即视为翻唱版本）
// 用于搜索排序降权，让原唱版本排在翻唱、钢琴版、DJ版、现场版之前，
// 避免用户点进纯音乐/翻唱版本导致歌词对不上（甚至无歌词）
var COVER_PATTERNS = [
    "live", "现场", "cover", "翻唱", "钢琴", "吉他", "伴奏",
    "纯音乐", "instrumental", "remix", "dj", "女声版", "男声版",
    "串烧", "电音版", "acoustic", "karaoke", "伴唱", "消音版",
];

// 判断条目是否为"非原唱版本"（标题含翻唱特征词）
function isCoverVersion(item) {
    var title = String(item.title || item.name || "").toLowerCase();
    for (var i = 0; i < COVER_PATTERNS.length; i++) {
        if (title.indexOf(COVER_PATTERNS[i]) !== -1) return true;
    }
    return false;
}

// 命中分数：2 = 标题 + 歌手都完全一致（原唱）；1 = 仅标题一致；0 = 其他
// 翻唱/伴奏/纯音乐等版本在此基础上降权 1 分，保证原唱版本排在前面；
// joox 源曲库以原唱录音为主，对「标题一致且非翻唱」的 joox 结果再加 0.5 分，
// 让"晴天""夜曲"这类不带歌手的搜索也能把原唱顶到最前；
// 搜索聚合后按分数排序，让原唱版本排在翻唱/钢琴版/现场版之前
function artistMatches(candidate, expected) {
    var actual = normText(artistText(candidate));
    var target = normText(expected);
    if (!target) return true;
    if (!actual) return false;
    return actual === target || actual.indexOf(target) !== -1 || target.indexOf(actual) !== -1;
}

function matchScore(item, title, artist) {
    var t = normText(title);
    var a = normText(artist);
    var it = normText(item.title || item.name);
    var score = 0;
    if (!t || !it) return -50;
    if (it === t) score += 24;
    else if (it.indexOf(t) !== -1 || t.indexOf(it) !== -1) score += 8;
    else return -50;
    if (a) score += artistMatches(item, artist) ? 24 : -40;
    if (isCoverVersion(item) && !isCoverVersion({ title: title })) score -= 24;
    if (!isCoverVersion(item) && (item._gdSource === "joox" || item.source === "joox")) {
        score += 0.5;
    }
    return score;
}

function queryScore(item, query) {
    var q = normText(query);
    var title = normText(item.title || item.name);
    var artist = normText(artistText(item));
    var combined = title + artist;
    var score = 0;
    if (!q || !title) return -20;
    if (q === title) score += 12;
    else if (q === combined || combined.indexOf(q) !== -1) score += 16;
    else if (q.indexOf(title) !== -1) score += 10;
    else if (title.indexOf(q) !== -1) score += 5;
    if (artist && q.indexOf(artist) !== -1) score += 8;
    if (isCoverVersion(item)) score -= 10;
    return score;
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
    var trackId = String(track.id || track.songmid || track.hash || track.rid || track.copyrightId || "");
    if (!trackId) return null;
    var album = track.al || track.album || {};
    var albumName = typeof album === "string" ? album : album.name || album.title || "";
    var picId = album.pic || album.picUrl || track.pic_id || track.picId || track.cover || null;
    var artistList = track.ar || track.artist || track.singer || track.artists || [];
    var artists = Array.isArray(artistList)
        ? artistList.map(function (a) { return typeof a === "string" ? a : a.name || a.title || ""; }).filter(Boolean).join(" / ")
        : String(artistList || "");
    return {
        id: source + "-" + trackId,
        platform: "GD音乐台",
        title: track.name || track.title || track.songname || "",
        artist: artists,
        album: albumName,
        duration: track.duration || track.dt || track.interval || undefined,
        artwork: typeof picId === "string" && /^https?:\/\//.test(picId) ? picId : undefined,
        _gdSource: source,
        _gdId: trackId,
        _gdPicId: picId,
        _gdLyricId: track.lyric_id || track.lyricId || trackId,
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
    var memoryKey = defaultSource + ":" + id;
    var candidates = [];
    var remembered = id ? SOURCE_MEMORY[memoryKey] : null;
    if (remembered && remembered !== defaultSource) candidates.push(remembered);
    if (candidates.indexOf(defaultSource) === -1) candidates.push(defaultSource);
    STABLE_SOURCES.forEach(function (s) {
        if (candidates.indexOf(s) === -1) candidates.push(s);
    });
    return { candidates: candidates, id: id, defaultSource: defaultSource, memoryKey: memoryKey };
}

function findTrackInSource(source, musicItem) {
    if (source === (musicItem._gdSource || "netease") && musicItem._gdId) {
        return Promise.resolve({
            id: musicItem._gdId,
            lyric_id: musicItem._gdLyricId || musicItem._gdId,
            source: source,
        });
    }
    var title = String(musicItem.title || "").trim();
    var artist = String(musicItem.artist || "").trim();
    if (!title) return Promise.resolve(null);
    var keyword = artist ? title + " " + artist : title;
    return searchOneSource(source, keyword, 1).then(function (items) {
        var scored = items.map(function (item) {
            item.source = item.source || source;
            return { item: item, score: matchScore(item, title, artist) };
        }).sort(function (a, b) { return b.score - a.score; });
        var minimum = artist ? 32 : 20;
        if (!scored.length || scored[0].score < minimum) return null;
        if (scored[1] && scored[0].score - scored[1].score < 6 &&
            !artistMatches(scored[1].item, artist)) return null;
        return scored[0].item;
    });
}

// 歌词兜底：候选源（joox/bilibili/tencent 等）歌词为空时，
// 用「歌名 + 歌手」并发搜索多个稳定源，按命中质量优先取原唱歌曲，再取其歌词。
// 仅在直接取歌词失败时才调用，尽量节省接口频率额度。
function fallbackSearchLyric(musicItem) {
    var keyword = String(musicItem.title || "").trim();
    if (!keyword) {
        return Promise.resolve(null);
    }
    var artist = String(musicItem.artist || "").trim();
    var name = artist ? keyword + " " + artist : keyword;
    var tasks = STABLE_SOURCES.map(function (source) {
        return searchOneSource(source, name, 1);
    });
    return Promise.all(tasks)
        .then(function (results) {
            var scored = [];
            results.forEach(function (items, index) {
                items.forEach(function (item) {
                    item.source = item.source || STABLE_SOURCES[index];
                    scored.push({
                        item: item,
                        score: matchScore(item, keyword, artist),
                    });
                });
            });
            scored.sort(function (a, b) { return b.score - a.score; });
            var minimum = artist ? 32 : 20;
            var candidates = scored.filter(function (entry) {
                return entry.score >= minimum;
            }).slice(0, 8);
            var index = 0;
            function next() {
                if (index >= candidates.length) return null;
                var found = candidates[index].item;
                index += 1;
                var nid = found.lyric_id || found.lyricId || found.id;
                if (!nid) return next();
                return requestGD({
                    types: "lyric",
                    source: found.source || "netease",
                    id: nid,
                }).then(function (data) {
                    if (data && data.lyric && !data.lyric.includes("暂无歌词")) {
                        return {
                            rawLrc: data.lyric,
                            translation: data.tlyric || undefined,
                        };
                    }
                    return next();
                }).catch(next);
            }
            return next();
        })
        .catch(function () {
            return null;
        });
}

module.exports = {
    platform: "GD音乐台",
    author: "GD Studio",
    version: "1.1.0",
    cacheControl: "no-cache",
    supportedSearchType: ["music", "lyric"],
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

    // 搜索：并发请求多个稳定源并聚合，按「歌名+歌手」命中质量排序，
    // 让原唱版本排在翻唱/钢琴版/现场版之前，避免播放/歌词匹配到错误版本
    search: function (query, page, type) {
        if (type !== "music" && type !== "lyric") {
            return Promise.resolve({ isEnd: true, data: [] });
        }
        var rawQuery = String(query || "").trim();
        if (!rawQuery) return Promise.resolve({ isEnd: true, data: [] });
        var pageNumber = Math.max(1, Number(page) || 1);
        var tasks = STABLE_SOURCES.map(function (source) {
            return searchOneSource(source, rawQuery, pageNumber);
        });
        return Promise.all(tasks).then(function (results) {
            var list = [];
            var hasFullPage = false;
            results.forEach(function (arr) {
                if (arr.length >= 20) hasFullPage = true;
                list = list.concat(arr);
            });
            var seen = {};
            var mapped = list.map(formatSearchItem).filter(function (item) {
                var key = item._gdSource + ":" + item._gdId;
                if (seen[key]) return false;
                seen[key] = true;
                return true;
            });
            mapped.sort(function (a, b) {
                return queryScore(b, rawQuery) - queryScore(a, rawQuery);
            });
            return {
                isEnd: !hasFullPage,
                data: mapped,
            };
        });
    },

    // 获取播放地址：优先记忆源 -> 默认源 -> 其他稳定源；每源内优先目标音质，失败降级 320
    // 成功后记录到源记忆，下次播放直接使用，避免每次歌单都从失效的默认源重新切换
    getMediaSource: function (musicItem, quality) {
        var srcInfo = buildSourceCandidates(musicItem);
        var brList = [QUALITY_BR[quality] || 320, 320];
        var candidateIdx = 0;
        function nextCandidate() {
            if (candidateIdx >= srcInfo.candidates.length) return Promise.resolve(null);
            var source = srcInfo.candidates[candidateIdx];
            candidateIdx += 1;
            return findTrackInSource(source, musicItem).then(function (track) {
                if (!track || !track.id) return nextCandidate();
                var brIdx = 0;
                function nextQuality() {
                    if (brIdx >= brList.length) return nextCandidate();
                    var br = brList[brIdx];
                    brIdx += 1;
                    return requestGD({ types: "url", source: source, id: track.id, br: br })
                        .then(function (data) {
                            if (data && data.url) {
                                if (srcInfo.id) SOURCE_MEMORY[srcInfo.memoryKey] = source;
                                return { url: data.url };
                            }
                            return nextQuality();
                        })
                        .catch(nextQuality);
                }
                return nextQuality();
            }).catch(nextCandidate);
        }
        return nextCandidate();
    },

    // 获取歌词（含翻译）：依次尝试候选源（记忆源 -> 默认源 -> 其他稳定源），
    // 单个源歌词缺失/失败/占位（如「暂无歌词」）时降级到下一个源，提高歌词命中率；
    // 候选源全部无歌词（joox/bilibili 等源歌词常为空）时，用「歌名+歌手」
    // 并发搜索稳定源取原唱歌词
    getLyric: function (musicItem) {
        var srcInfo = buildSourceCandidates(musicItem);
        var candidateIdx = 0;
        function nextCandidate() {
            if (candidateIdx >= srcInfo.candidates.length) {
                return fallbackSearchLyric(musicItem);
            }
            var source = srcInfo.candidates[candidateIdx];
            candidateIdx += 1;
            return findTrackInSource(source, musicItem).then(function (track) {
                if (!track) return nextCandidate();
                var lyricId = track.lyric_id || track.lyricId || track.id;
                if (!lyricId) return nextCandidate();
                return requestGD({
                    types: "lyric",
                    source: source,
                    id: lyricId,
                }).then(function (data) {
                    if (data && data.lyric && !data.lyric.includes("暂无歌词")) {
                        return {
                            rawLrc: data.lyric,
                            translation: data.tlyric || undefined,
                        };
                    }
                    return nextCandidate();
                }).catch(nextCandidate);
            }).catch(nextCandidate);
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
        var page = 1;
        var count = 100;
        var maxPages = 20;
        var tracks = [];
        var seenTracks = {};
        var seenPages = {};
        function nextPage() {
            return requestGD({
                types: "playlist",
                source: parsed.source,
                id: parsed.id,
                count: count,
                pages: page,
            }).then(function (data) {
                var pageTracks = [];
                if (data && data.playlist && Array.isArray(data.playlist.tracks)) {
                    pageTracks = data.playlist.tracks;
                } else if (data && Array.isArray(data.tracks)) {
                    pageTracks = data.tracks;
                } else if (Array.isArray(data)) {
                    pageTracks = data;
                }
                if (!pageTracks.length) return tracks;
                var pageKeys = [];
                pageTracks.forEach(function (track) {
                    var formatted = formatPlaylistTrack(track, parsed.source);
                    if (!formatted) return;
                    var key = formatted._gdSource + ":" + formatted._gdId;
                    pageKeys.push(key);
                    if (seenTracks[key]) return;
                    seenTracks[key] = true;
                    tracks.push(formatted);
                });
                var pageSignature = pageKeys.join("|");
                if (!pageSignature || seenPages[pageSignature]) return tracks;
                seenPages[pageSignature] = true;
                var total = data && data.playlist && Number(data.playlist.trackCount || data.playlist.total || 0);
                var hasMore = total > 0 ? tracks.length < total : pageTracks.length >= count;
                if (hasMore && page < maxPages) {
                    page += 1;
                    return nextPage();
                }
                return tracks;
            });
        }
        return nextPage().then(function (result) {
            return result.length ? result : null;
        }).catch(function () {
            return tracks.length ? tracks : null;
        });
    },
};
