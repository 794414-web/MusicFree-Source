import checkUpdate from "../checkUpdate";

jest.mock("react-native-device-info", () => ({
    getVersion: jest.fn(() => "1.0.3"),
}));

jest.mock("@/native/apkUpdate", () => ({
    ApkUpdateModule: {
        checkUpdate: jest.fn(),
    },
}));

import { ApkUpdateModule } from "@/native/apkUpdate";

beforeEach(() => {
    jest.clearAllMocks();
});

const mockResult = (overrides: Record<string, any> = {}) => ({
    needUpdate: true,
    version: "1.0.4",
    changeLog: ["## 更新内容", "- 修复检查更新"],
    download: [
        "https://gitee.com/ken794414/MusicFree-Source/releases/download/v1.0.4/MusicFree-1.0.4-universal.apk",
    ],
    ...overrides,
});

describe("checkUpdate (native ApkUpdateModule)", () => {
    test("有更新 → 返回 updateInfo", async () => {
        (ApkUpdateModule.checkUpdate as jest.Mock).mockResolvedValueOnce(
            mockResult(),
        );

        const result = await checkUpdate();

        expect(result.updateInfo).toBeDefined();
        expect(result.updateInfo!.needUpdate).toBe(true);
        expect(result.updateInfo!.data.version).toBe("1.0.4");
        expect(result.updateInfo!.data.download[0]).toContain("universal");
    });

    test("无需更新 → 返回空对象", async () => {
        (ApkUpdateModule.checkUpdate as jest.Mock).mockResolvedValueOnce({
            needUpdate: false,
        });

        const result = await checkUpdate();

        expect(result.updateInfo).toBeUndefined();
        expect(result.error).toBeUndefined();
    });

    test("原生层抛错 → 返回 error", async () => {
        (ApkUpdateModule.checkUpdate as jest.Mock).mockRejectedValueOnce(
            new Error("无法访问 Gitee API: 网络连接失败"),
        );

        const result = await checkUpdate();

        expect(result.error).toBe("无法访问 Gitee API: 网络连接失败");
    });

    test("空 changeLog → 回退默认值", async () => {
        (ApkUpdateModule.checkUpdate as jest.Mock).mockResolvedValueOnce(
            mockResult({ changeLog: undefined }),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.changeLog).toEqual(["新版本可用"]);
    });

    test("空 download → 返回空数组", async () => {
        (ApkUpdateModule.checkUpdate as jest.Mock).mockResolvedValueOnce(
            mockResult({ download: undefined }),
        );

        const result = await checkUpdate();

        expect(result.updateInfo!.data.download).toEqual([]);
    });

    test("应将当前版本传给原生方法", async () => {
        const DeviceInfo = require("react-native-device-info");
        DeviceInfo.getVersion.mockReturnValueOnce("2.0.0");
        (ApkUpdateModule.checkUpdate as jest.Mock).mockResolvedValueOnce({
            needUpdate: false,
        });

        await checkUpdate();

        expect(ApkUpdateModule.checkUpdate).toHaveBeenCalledWith("2.0.0");
    });
});
