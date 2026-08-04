import axios from "axios";
import checkUpdate from "../checkUpdate";

// mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// mock react-native-device-info，默认当前版本 0.8.3
jest.mock("react-native-device-info", () => ({
    getVersion: jest.fn(() => "0.8.3"),
}));
jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
}));

// 构造 GitHub API 真实结构的 mock 数据
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

const mockAxiosResponse = (data: any) => ({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as any,
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe("checkUpdate - 版本更新检查逻辑", () => {
    // ============ 场景 1：有更新（核心路径）============
    test("当前版本 0.8.3 < 服务器 0.8.4 → 应返回 needUpdate=true 及排序后的下载链接", async () => {
        mockedAxios.get.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.needUpdate).toBe(true);
        expect(result.updateInfo!.data.version).toBe("0.8.4");

        // universal 应排第一（主下载），arm64 第二（备用）
        const urls = result.updateInfo!.data.download;
        expect(urls).toHaveLength(2);
        expect(urls[0]).toContain("app-universal-release.apk");
        expect(urls[1]).toContain("app-arm64-v8a-release.apk");

        // changelog 按行分割并过滤空行
        expect(result.updateInfo!.data.changeLog).toEqual([
            "## 更新内容",
            "- 修复搜索",
            "- 修复更新",
        ]);
    });

    // ============ 场景 2：无需更新 ============
    test("当前版本等于服务器版本 → 应返回空对象（无 updateInfo / 无 error）", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("0.8.4");

        mockedAxios.get.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeUndefined();
        expect(result.error).toBeUndefined();
    });

    test("当前版本高于服务器版本 → 应返回空对象", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("0.99.0");

        mockedAxios.get.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        expect(result.updateInfo).toBeUndefined();
        expect(result.error).toBeUndefined();
    });

    // ============ 场景 3：tag 前缀格式 ============
    test("tag_name 不带 v 前缀时也能正确解析版本号", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("0.8.3");

        mockedAxios.get.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ tag_name: "0.8.4" })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.data.version).toBe("0.8.4");
    });

    // ============ 场景 4：APK 排序规则 ============
    test("APK 资源排序：universal 永远在 arm64 之前，即使 API 返回顺序相反", async () => {
        mockedAxios.get.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        const result = await checkUpdate();

        const urls = result.updateInfo!.data.download;
        // API 返回 arm64 在前，但排序后 universal 应在第一位
        expect(urls[0]).toMatch(/universal/i);
        expect(urls[1]).toMatch(/arm64/i);
    });

    test("仅有一种 APK 时也能正常返回单链接", async () => {
        mockedAxios.get.mockResolvedValueOnce(
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

    // ============ 场景 5：无 APK 资源时回退到 release 页面 ============
    test("Release 无 APK assets → 回退到 html_url 作为下载链接", async () => {
        mockedAxios.get.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ assets: [] })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toEqual([
            "https://github.com/794414-web/MusicFree-Source/releases/tag/v0.8.4",
        ]);
    });

    test("Release assets 为 undefined → 回退到 html_url", async () => {
        mockedAxios.get.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ assets: undefined as any })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toHaveLength(1);
        expect(result.updateInfo!.data.download[0]).toContain("/releases/tag/");
    });

    // ============ 场景 6：空 body changelog 回退 ============
    test("body 为空字符串 → changelog 回退为 ['新版本可用']", async () => {
        mockedAxios.get.mockResolvedValueOnce(
            mockAxiosResponse(mockRelease({ body: "" })),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.changeLog).toEqual(["新版本可用"]);
    });

    // ============ 场景 7：API 返回异常数据 ============
    test("API 返回无 tag_name → 返回 '无法获取版本信息' 错误", async () => {
        mockedAxios.get.mockResolvedValueOnce(
            mockAxiosResponse({ html_url: "xxx" }),
        );

        const result = await checkUpdate();

        expect(result.error).toBe("无法获取版本信息");
        expect(result.updateInfo).toBeUndefined();
    });

    // ============ 场景 8：网络错误分类 ============
    test("HTTP 403 → 返回 'GitHub API 请求受限' 错误", async () => {
        const err = new Error("Request failed");
        (err as any).response = { status: 403 };
        mockedAxios.get.mockRejectedValueOnce(err);

        const result = await checkUpdate();

        expect(result.error).toBe("GitHub API 请求受限，请稍后再试");
    });

    test("请求超时 ECONNABORTED → 返回 '检查更新超时' 错误", async () => {
        const err = new Error("timeout");
        (err as any).code = "ECONNABORTED";
        mockedAxios.get.mockRejectedValueOnce(err);

        const result = await checkUpdate();

        expect(result.error).toBe("检查更新超时，请检查网络");
    });

    test("普通网络错误 → 返回 error.message", async () => {
        mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

        const result = await checkUpdate();

        expect(result.error).toBe("Network Error");
    });

    test("未知异常无 message → 返回 '网络错误'", async () => {
        mockedAxios.get.mockRejectedValueOnce({});

        const result = await checkUpdate();

        expect(result.error).toBe("网络错误");
    });

    // ============ 场景 9：请求参数验证 ============
    test("应使用正确的 GitHub API URL 和请求头", async () => {
        mockedAxios.get.mockResolvedValueOnce(mockAxiosResponse(mockRelease()));

        await checkUpdate();

        expect(mockedAxios.get).toHaveBeenCalledWith(
            "https://api.github.com/repos/794414-web/MusicFree-Source/releases/latest",
            {
                headers: { Accept: "application/vnd.github+json" },
                timeout: 15000,
            },
        );
    });
});
