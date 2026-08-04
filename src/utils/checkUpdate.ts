import axios from "axios";
import { compare } from "compare-versions";
import DeviceInfo from "react-native-device-info";

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

interface IGitHubRelease {
    tag_name: string;
    body: string;
    html_url: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
}

export default async function checkUpdate(): Promise<IUpdateInfo | undefined> {
    const currentVersion = DeviceInfo.getVersion();
    try {
        const response = await axios.get<IGitHubRelease>(GITHUB_API, {
            headers: { Accept: "application/vnd.github+json" },
            timeout: 15000,
        });
        const release = response.data;
        if (!release?.tag_name) return;

        // 去掉 tag 前缀 "v" 得到纯版本号
        const latestVersion = release.tag_name.replace(/^v/i, "");

        if (compare(latestVersion, currentVersion, ">")) {
            // 找到 APK 下载链接
            const apkAssets = release.assets?.filter(a =>
                a.name.toLowerCase().endsWith(".apk"),
            );

            const downloadUrls = apkAssets?.length
                ? apkAssets.map(a => a.browser_download_url)
                : [release.html_url];

            // 将 release body 按行分割作为 changelog
            const changeLog = release.body
                ? release.body.split("\n").filter(line => line.trim())
                : ["新版本可用"];

            return {
                needUpdate: true,
                data: {
                    version: latestVersion,
                    changeLog,
                    download: downloadUrls,
                },
            };
        }
    } catch {}
}
