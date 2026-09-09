jest.mock("axios", () => ({
    get: jest.fn(),
}));

const axios = require("axios");
const plugin = require("../gdstudio");

function response(data) {
    return Promise.resolve({ data });
}

describe("GD音乐台", () => {
    beforeEach(() => {
        axios.get.mockReset();
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
});
