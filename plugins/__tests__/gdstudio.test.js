jest.mock("axios", () => ({
    get: jest.fn(),
    post: jest.fn(),
}));

const axios = require("axios");
const plugin = require("../gdstudio");

function response(data) {
    return Promise.resolve({ data });
}

describe("GD音乐台", () => {
    beforeEach(() => {
        axios.get.mockReset();
        axios.post.mockReset();
    });

    test("搜索时保留完整关键词、去重并优先原唱", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            expect(params.name).toBe("晴天 周杰伦");
            if (params.source === "netease") {
                return response([
                    {
                        id: "original",
                        name: "晴天",
                        artist: ["周杰伦"],
                        source: "netease",
                    },
                    {
                        id: "live",
                        name: "晴天 (Live)",
                        artist: ["周杰伦"],
                        source: "netease",
                    },
                    {
                        id: "original",
                        name: "晴天",
                        artist: ["周杰伦"],
                        source: "netease",
                    },
                ]);
            }
            if (params.source === "joox") {
                return response([
                    {
                        id: "cover",
                        name: "晴天 (翻唱)",
                        artist: ["其他歌手"],
                        source: "joox",
                    },
                ]);
            }
            return response([]);
        });

        const result = await plugin.search("晴天 周杰伦", 1, "music");

        expect(result.data).toHaveLength(3);
        expect(result.data[0]).toMatchObject({
            title: "晴天",
            artist: "周杰伦",
            _gdId: "original",
        });
    });

    test("分页导入歌单时去除重复歌曲", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            expect(params.types).toBe("playlist");
            if (params.pages === 1) {
                return response({
                    playlist: {
                        trackCount: 3,
                        tracks: [
                            { id: 1, name: "一", artist: ["甲"] },
                            { id: 2, name: "二", artist: ["乙"] },
                        ],
                    },
                });
            }
            return response({
                playlist: {
                    trackCount: 3,
                    tracks: [
                        { id: 2, name: "二", artist: ["乙"] },
                        { id: 3, name: "三", artist: ["丙"] },
                    ],
                },
            });
        });

        const result = await plugin.importMusicSheet(
            "https://music.163.com/#/playlist?id=123456",
        );

        expect(result.map(item => item._gdId)).toEqual(["1", "2", "3"]);
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    test("切换来源时重新搜索并使用目标来源歌词ID", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            if (params.types === "lyric" && params.source === "bilibili") {
                expect(params.id).toBe("bili-lyric");
                return response({ lyric: "暂无歌词" });
            }
            if (params.types === "search" && params.source === "netease") {
                return response([
                    {
                        id: "netease-song",
                        lyric_id: "netease-lyric",
                        name: "晴天",
                        artist: ["周杰伦"],
                        source: "netease",
                    },
                ]);
            }
            if (params.types === "lyric" && params.source === "netease") {
                expect(params.id).toBe("netease-lyric");
                return response({ lyric: "[00:00.00]故事的小黄花" });
            }
            return response([]);
        });

        const result = await plugin.getLyric({
            title: "晴天",
            artist: "周杰伦",
            _gdSource: "bilibili",
            _gdId: "bili-song",
            _gdLyricId: "bili-lyric",
        });

        expect(result.rawLrc).toContain("故事的小黄花");
    });

    test("繁体歌手名（周杰倫）能正确匹配到简体原唱", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            // netease 直接取地址失败，触发切换到 joox 重新搜索
            if (params.types === "url" && params.source === "netease") {
                return response({ url: "", br: -1, size: 0 });
            }
            if (params.types === "search" && params.source === "joox") {
                // joox 返回繁体歌手名 + 翻唱版本，原唱应胜出
                return response([
                    {
                        id: "joox-original",
                        name: "晴天",
                        artist: ["周杰倫"],
                        source: "joox",
                    },
                    {
                        id: "joox-cover",
                        name: "晴天 (翻唱)",
                        artist: ["其他歌手"],
                        source: "joox",
                    },
                ]);
            }
            if (params.types === "url" && params.source === "joox") {
                return response({ url: "https://example.com/joox.mp3", br: 320 });
            }
            return response([]);
        });

        const result = await plugin.getMediaSource(
            {
                title: "晴天",
                artist: "周杰伦",
                _gdSource: "netease",
                _gdId: "netease-1",
                _gdLyricId: "netease-1",
            },
            "standard",
        );

        expect(result.url).toBe("https://example.com/joox.mp3");
    });

    test("QQ歌单歌手名错误时回退到仅歌名搜索取原唱", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            // 第一轮：「逆战 赖志锐」搜索无匹配（QQ 歌单把原唱标成了翻唱歌手）
            if (params.types === "search" && params.name === "逆战 赖志锐") {
                return response([]);
            }
            // 回退：仅「逆战」搜索，返回原唱 + 翻唱，应选中原唱
            if (params.types === "search" && params.name === "逆战") {
                return response([
                    { id: "cover-id", name: "逆战 (Live)", artist: ["某翻唱"], source: "netease" },
                    { id: "original-id", name: "逆战", artist: ["张杰"], source: "netease" },
                ]);
            }
            if (params.types === "url" && params.source === "netease") {
                return response({ url: "https://example.com/nizhan.mp3", br: 320 });
            }
            return response([]);
        });

        const result = await plugin.getMediaSource(
            {
                title: "逆战",
                artist: "赖志锐",
                _gdSource: "qqmeta",
                _gdId: "",
                _gdLyricId: "",
            },
            "standard",
        );

        expect(result.url).toBe("https://example.com/nizhan.mp3");
    });

    test("导入 QQ 音乐歌单返回曲目列表", async () => {
        axios.post.mockImplementation((url, body) => {
            expect(url).toBe("https://u.y.qq.com/cgi-bin/musicu.fcg");
            return Promise.resolve({
                data: {
                    req: {
                        code: 0,
                        data: {
                            dirinfo: { songnum: 2 },
                            songlist: [
                                {
                                    mid: "qq-song-1",
                                    name: "晴天",
                                    singer: [{ name: "周杰伦" }],
                                    album: { name: "叶惠美", mid: "001abc" },
                                    interval: 269,
                                },
                                {
                                    mid: "qq-song-2",
                                    name: "稻香",
                                    singer: [{ name: "周杰伦" }],
                                    album: { name: "魔杰座", mid: "002def" },
                                    interval: 223,
                                },
                            ],
                        },
                    },
                },
            });
        });

        const result = await plugin.importMusicSheet(
            "https://y.qq.com/n/ryqq/playlist/7707261125",
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            title: "晴天",
            artist: "周杰伦",
            album: "叶惠美",
            duration: 269000,
            _gdSource: "qqmeta",
            _gdId: "",
        });
        expect(result[0].artwork).toContain("001abc");
    });

    test("getTopLists 返回网易云榜单分组", async () => {
        const groups = await plugin.getTopLists();
        expect(Array.isArray(groups)).toBe(true);
        expect(groups[0].title).toBe("网易云榜单");
        expect(groups[0].data.length).toBeGreaterThan(0);
        expect(groups[0].data[0]).toMatchObject({
            platform: "GD音乐台",
            _gdSource: "netease",
        });
        expect(groups[0].data[0].id).toBeTruthy();
    });

    test("getTopListDetail 分页拉取榜单曲目并判定 isEnd", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            expect(params.types).toBe("playlist");
            expect(params.source).toBe("netease");
            return response({
                playlist: {
                    name: "热歌榜",
                    coverImgUrl: "https://example.com/cover.jpg",
                    trackCount: 250,
                    tracks: [
                        { id: 11, name: "歌一", ar: [{ name: "歌手甲" }] },
                        { id: 12, name: "歌二", ar: [{ name: "歌手乙" }] },
                    ],
                },
            });
        });

        const result = await plugin.getTopListDetail(
            { id: "3778678", title: "热歌榜", _gdSource: "netease" },
            1,
        );

        expect(result.isEnd).toBe(false);
        expect(result.musicList).toHaveLength(2);
        expect(result.musicList[0]).toMatchObject({
            title: "歌一",
            artist: "歌手甲",
            _gdSource: "netease",
            _gdId: "11",
        });
        expect(result.topListItem.coverImg).toBe("https://example.com/cover.jpg");
    });

    test("getMusicSheetInfo 拉取歌单曲目，最后一页 isEnd 为 true", async () => {
        axios.get.mockImplementation((url, config) => {
            const params = config.params;
            expect(params.types).toBe("playlist");
            return response({
                playlist: {
                    name: "我的歌单",
                    trackCount: 2,
                    tracks: [
                        { id: 21, name: "甲", ar: [{ name: "A" }] },
                        { id: 22, name: "乙", ar: [{ name: "B" }] },
                    ],
                },
            });
        });

        const result = await plugin.getMusicSheetInfo(
            { id: "999", title: "我的歌单", _gdSource: "netease" },
            1,
        );

        expect(result.isEnd).toBe(true);
        expect(result.musicList).toHaveLength(2);
        expect(result.musicList[1]._gdId).toBe("22");
    });

    test("遇到429限流时按指数退避自动重试直到成功", async () => {
        jest.useFakeTimers();
        const attempts = [];
        const rateLimited = new Error("Request rate limit exceeded");
        rateLimited.response = { status: 429 };
        axios.get.mockImplementation(() => {
            attempts.push(Date.now());
            if (attempts.length < 3) return Promise.reject(rateLimited);
            return Promise.resolve({
                data: { url: "https://example.com/song.mp3", br: 320 },
            });
        });

        const promise = plugin.getMediaSource(
            { id: "netease-42", title: "歌", artist: "人", _gdSource: "netease", _gdId: "42" },
            "standard",
        );
        // 第一次 sleep(1000) 触发 retry 1；第二次 sleep(2000) 触发 retry 2
        await jest.advanceTimersByTimeAsync(3000);
        const result = await promise;

        expect(attempts.length).toBe(3);
        expect(result.url).toBe("https://example.com/song.mp3");
        jest.useRealTimers();
    });

    test("GD 请求带上 User-Agent 头部", async () => {
        let capturedConfig = null;
        axios.get.mockImplementation((url, config) => {
            capturedConfig = config;
            return response([]);
        });
        await plugin.search("测试", 1, "music");
        expect(capturedConfig).toBeTruthy();
        expect(capturedConfig.headers).toBeTruthy();
        expect(capturedConfig.headers["User-Agent"]).toMatch(/Mozilla/);
    });

    test("遇到503临时错误时按指数退避自动重试直到成功", async () => {
        jest.useFakeTimers();
        const attempts = [];
        const serviceDown = new Error("Request failed with status code 503");
        serviceDown.response = { status: 503 };
        axios.get.mockImplementation(() => {
            attempts.push(Date.now());
            if (attempts.length < 3) return Promise.reject(serviceDown);
            return Promise.resolve({
                data: { url: "https://example.com/song.mp3", br: 320 },
            });
        });

        const promise = plugin.getMediaSource(
            { id: "netease-42", title: "歌", artist: "人", _gdSource: "netease", _gdId: "42" },
            "standard",
        );
        await jest.advanceTimersByTimeAsync(3000);
        const result = await promise;

        expect(attempts.length).toBe(3);
        expect(result.url).toBe("https://example.com/song.mp3");
        jest.useRealTimers();
    });
});
