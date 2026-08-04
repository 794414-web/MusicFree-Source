import axios from "axios";
import { compare } from "compare-versions";
import DeviceInfo from "react-native-device-info";
import { errorLog } from "@/utils/log";

/** GitHub 仓库地址 */
const GITHUB_REPO = "794414-web/MusicFree-Source";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

interface IUpdateInfo {
    needUpdate: boolean;
    data: {
        version: string;
        changeLog: string[];
        download: string[];
    };
}

interface ICheckUpdateResult {
    updateInfo?: IUpdateInfo;
    error?: string;
}

interface IGitHubRelease {
    tag_name: string;
    body: string;
    html_url: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
}

export default async function checkUpdate(): Promise<ICheckUpdateResult> {
    const currentVersion = DeviceInfo.getVersion();
    try {
        const response = await axios.get<IGitHubRelease>(GITHUB_API, {
            headers: { Accept: "application/vnd.github+json" },
            timeout: 15000,
        });
        const release = response.data;
        if (!release?.tag_name) {
            return { error: "无法获取版本信息" };
        }

        // 去掉 tag 前缀 "v" 得到纯版本号
        const latestVersion = release.tag_name.replace(/^v/i, "");

        if (compare(latestVersion, currentVersion, ">")) {
            // 找到 APK 下载链接，优先选择 universal 或 arm64
            const apkAssets = (release.assets ?? []).filter(a =>
                a.name.toLowerCase().endsWith(".apk"),
            );

            // 排序：universal 优先，其次 arm64-v8a
            const sortedAssets = [...apkAssets].sort((a, b) => {
                const au = a.name.toLowerCase().includes("universal") ? 0 : 1;
                const bu = b.name.toLowerCase().includes("universal") ? 0 : 1;
                if (au !== bu) return au - bu;
                const aa = a.name.toLowerCase().includes("arm64") ? 0 : 1;
                const ba = b.name.toLowerCase().includes("arm64") ? 0 : 1;
                return aa - ba;
            });

            const downloadUrls = sortedAssets.length
                ? sortedAssets.map(a => a.browser_download_url)
                : [release.html_url];

            // 将 release body 按行分割作为 changelog
            const changeLog = release.body
                ? release.body.split("\n").filter(line => line.trim())
                : ["新版本可用"];

            return {
                updateInfo: {
                    needUpdate: true,
                    data: {
                        version: latestVersion,
                        changeLog,
                        download: downloadUrls,
                    },
                },
            };
        }

        return {};
    } catch (e: any) {
        const msg = e?.response?.status === 403
            ? "GitHub API 请求受限，请稍后再试"
            : e?.code === "ECONNABORTED"
                ? "检查更新超时，请检查网络"
                : e?.message || "网络错误";
        errorLog("检查更新失败", msg);
        return { error: msg };
    }
}
