import checkUpdate from "../checkUpdate";

jest.mock("react-native-device-info", () => ({
    getVersion: jest.fn(() => "0.8.3"),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
}));

jest.mock("axios", () => {
    const mockGet = jest.fn();
    const create = jest.fn(() => ({ get: mockGet }));
    const mockAxios = { create };
    return {
        default: mockAxios,
        create,
        __mockGet: mockGet,
        __mockCreate: create,
    };
});

import axios from "axios";

beforeEach(() => {
    const { __mockGet: mockGet } = jest.requireMock("axios");
    mockGet.mockClear();
});

afterEach(() => {
    jest.restoreAllMocks();
});

const getMockGet = () => {
    const { __mockGet: mockGet } = jest.requireMock("axios");
    return mockGet as jest.Mock;
};

const getMockCreate = () => {
    const { __mockCreate: mockCreate } = jest.requireMock("axios");
    return mockCreate as jest.Mock;
};

const mockRelease = (overrides: Partial<{
    tag_name: string;
    body: string;
    html_url: string;
    assets: Array<{ name: string; browser_download_url: string; size?: number }>;
}> = {}) => ({
    tag_name: "v0.8.4",
    name: "V8.4",
    body: "## 更新内容\n- 修复搜索\n- 修复更新",
    html_url: "https://github.com/794414-web/MusicFree-Source/releases/tag/v0.8.4",
    assets: [
        {
            name: "app-arm64-v8a-release.apk",
            browser_download_url: "https://github.com/794414-web/MusicFree-Source/releases/download/v0.8.4/app-arm64-v8a-release.apk",
            size: 21776999,
        },
        {
            name: "app-universal-release.apk",
            browser_download_url: "https://github.com/794414-web/MusicFree-Source/releases/download/v0.8.4/app-universal-release.apk",
            size: 35224664,
        },
    ],
    ...overrides,
});

const mockAxiosResponse = (data: any, status = 200) => ({
    data,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    headers: {},
    config: {},
});

const mockAxiosError = (message: string, code?: string, status?: number) => {
    const err: any = new Error(message);
    if (code) err.code = code;
    if (status) {
        err.response = { status, data: {}, headers: {} };
    }
    return err;
};

describe("checkUpdate - 版本更新检查逻辑 (axios)", () => {
    test("axios.create 应被调用创建专用实例", () => {
        const mockCreate = getMockCreate();
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                timeout: 15000,
                headers: expect.objectContaining({
                    Accept: "application/vnd.github+json",
                    "User-Agent": "MusicFree",
                }),
            }),
        );
    });

    // ============ 场景 1：有更新（核心路径）============
    test("当前版本 0.8.3 < 服务器 0.8.4 → 返回 needUpdate=true 及排序后的下载链接", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.needUpdate).toBe(true);
        expect(result.updateInfo!.data.version).toBe("0.8.4");

        const urls = result.updateInfo!.data.download;
        expect(urls).toHaveLength(2);
        expect(urls[0]).toContain("app-universal-release.apk");
        expect(urls[1]).toContain("app-arm64-v8a-release.apk");

        expect(result.updateInfo!.data.changeLog).toEqual([
            "## 更新内容",
            "- 修复搜索",
            "- 修复更新",
        ]);
    });

    // ============ 场景 2：无需更新 ============
    test("当前版本等于服务器版本 → 返回空对象", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("0.8.4");

        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeUndefined();
        expect(result.error).toBeUndefined();
    });

    test("当前版本高于服务器版本 → 返回空对象", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("0.99.0");

        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeUndefined();
        expect(result.error).toBeUndefined();
    });

    // ============ 场景 3：tag 前缀格式 ============
    test("tag_name 不带 v 前缀也能正确解析", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("0.8.3");

        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ tag_name: "0.8.4" })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.data.version).toBe("0.8.4");
    });

    // ============ 场景 4：APK 排序规则 ============
    test("APK 排序：universal 在 arm64 之前", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        const urls = result.updateInfo!.data.download;
        expect(urls[0]).toMatch(/universal/i);
        expect(urls[1]).toMatch(/arm64/i);
    });

    test("仅有一种 APK → 返回单链接", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse(
                mockRelease({
                    assets: [
                        {
                            name: "app-arm64-v8a-release.apk",
                            browser_download_url: "https://example.com/app-arm64.apk",
                        },
                    ],
                }),
            ),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toEqual([
            "https://example.com/app-arm64.apk",
        ]);
    });

    // ============ 场景 5：无 APK 资源时回退 ============
    test("Release 无 APK assets → 回退 html_url", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ assets: [] })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toEqual([
            "https://github.com/794414-web/MusicFree-Source/releases/tag/v0.8.4",
        ]);
    });

    test("Release assets 为 undefined → 回退 html_url", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ assets: undefined as any })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toHaveLength(1);
        expect(result.updateInfo!.data.download[0]).toContain("/releases/tag/");
    });

    // ============ 场景 6：空 body changelog 回退 ============
    test("body 为空 → changelog 回退为 ['新版本可用']", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ body: "" })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.changeLog).toEqual(["新版本可用"]);
    });

    // ============ 场景 7：API 返回异常数据 ============
    test("API 无 tag_name → 返回 '无法获取版本信息'", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse({ html_url: "xxx" }),
        );

        const result = await checkUpdate();

        expect(result.error).toBe("无法获取版本信息");
        expect(result.updateInfo).toBeUndefined();
    });

    // ============ 场景 8：网络错误分类 ============
    test("latest 接口返回 403 → 诊断也 403 → 直接返回诊断错误", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 403));
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 403));

        const result = await checkUpdate();

        expect(result.error).toContain("HTTP 403");
    });

    test("请求超时 (ECONNABORTED) → 返回超时错误", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("timeout", "ECONNABORTED"));

        const result = await checkUpdate();

        expect(result.error).toContain("超时");
    });

    test("普通网络错误 → 诊断失败 → 返回网络错误信息", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("Network Error"));
        mockGet.mockRejectedValueOnce(mockAxiosError("DNS failed"));

        const result = await checkUpdate();

        expect(result.error).toBeDefined();
    });

    // ============ 场景 9：请求参数验证 ============
    test("应使用正确的 GitHub API URL", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        await checkUpdate();

        expect(mockGet).toHaveBeenCalledWith(
            "https://api.github.com/repos/794414-web/MusicFree-Source/releases/latest",
        );
    });

    // ============ 场景 10：latest 失败回退到 releases 列表 ============
    test("latest 返回非 200 → 诊断成功 → 回退 releases 列表", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 500));
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 200));
        mockGet.mockResolvedValueOnce(mockAxiosResponse([mockRelease()]));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.needUpdate).toBe(true);
        expect(result.updateInfo!.data.version).toBe("0.8.4");
    });

    test("latest 失败抛异常 → 诊断成功 → 回退 releases 列表", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("Network request failed"));
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 200));
        mockGet.mockResolvedValueOnce(mockAxiosResponse([mockRelease()]));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.needUpdate).toBe(true);
        expect(result.updateInfo!.data.version).toBe("0.8.4");
    });

    test("latest 失败且诊断也失败 → 返回网络错误", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("Network request failed"));
        mockGet.mockRejectedValueOnce(mockAxiosError("Network request failed"));

        const result = await checkUpdate();

        expect(result.error).toBeDefined();
    });

    test("latest 返回 404 → 诊断成功 → releases 列表为空 → 暂无可用版本", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 404));
        mockGet.mockResolvedValueOnce(mockAxiosResponse(null, 200));
        mockGet.mockResolvedValueOnce(mockAxiosResponse([]));

        const result = await checkUpdate();

        expect(result.error).toBe("暂无可用版本");
    });
});
