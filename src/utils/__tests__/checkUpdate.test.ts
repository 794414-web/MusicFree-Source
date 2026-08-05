import checkUpdate from "../checkUpdate";

jest.mock("react-native-device-info", () => ({
    getVersion: jest.fn(() => "0.8.3"),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
}));

jest.mock("axios", () => {
    const mockGet = jest.fn();
    return {
        default: { get: mockGet },
        get: mockGet,
        __mockGet: mockGet,
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

describe("checkUpdate", () => {
    // ============ 场景 1：有更新（核心路径）============
    test("当前版本 0.8.3 < 服务器 0.8.4 → 返回 needUpdate=true", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.needUpdate).toBe(true);
        expect(result.updateInfo!.data.version).toBe("0.8.4");
    });

    test("下载链接：优先 universal APK", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        const url = result.updateInfo!.data.download[0];
        expect(url).toContain("app-universal-release.apk");
    });

    test("更新日志正确解析", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

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

        expect(result.updateInfo!.data.version).toBe("0.8.4");
    });

    // ============ 场景 4：APK 排序规则 ============
    test("仅有一个 APK → 直接返回该链接", async () => {
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
    test("无 APK assets → 回退 html_url", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ assets: [] })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toEqual([
            "https://github.com/794414-web/MusicFree-Source/releases/tag/v0.8.4",
        ]);
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

    // ============ 场景 7：网络错误处理 ============
    test("请求超时 (ECONNABORTED) → 返回超时错误", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("timeout", "ECONNABORTED"));

        const result = await checkUpdate();

        expect(result.error).toContain("超时");
    });

    test("403 限流 → 返回对应错误", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("Request failed", undefined, 403));

        const result = await checkUpdate();

        expect(result.error).toContain("受限");
    });

    test("404 不存在 → 返回对应错误", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("Not found", undefined, 404));

        const result = await checkUpdate();

        expect(result.error).toContain("未找到");
    });

    test("普通网络错误 → 返回原始错误信息", async () => {
        const mockGet = getMockGet();
        mockGet.mockRejectedValueOnce(mockAxiosError("Network request failed"));

        const result = await checkUpdate();

        expect(result.error).toContain("Network request failed");
    });

    // ============ 场景 8：请求参数验证 ============
    test("应使用正确的 GitHub API URL 和 15s 超时", async () => {
        const mockGet = getMockGet();
        mockGet.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        await checkUpdate();

        expect(mockGet).toHaveBeenCalledWith(
            "https://api.github.com/repos/794414-web/MusicFree-Source/releases/latest",
            { timeout: 15000 },
        );
    });
});
