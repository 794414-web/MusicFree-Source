import axios from "axios";
import { compare } from "compare-versions";
import DeviceInfo from "react-native-device-info";
import { errorLog } from "@/utils/log";

const REPO = "794414-web/MusicFree-Source";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export default async function checkUpdate() {
    const currentVersion = DeviceInfo.getVersion();

    try {
        const { data } = await axios.get(LATEST_URL, {
            timeout: 15000,
        });

        const tagName = data.tag_name || "";
        const latestVersion = tagName.replace(/^v/i, "");

        if (!latestVersion || !compare(latestVersion, currentVersion, ">")) {
            return {};
        }

        const assets = data.assets || [];
        const apkAsset = assets
            .filter((a: any) => a.name.toLowerCase().endsWith(".apk"))
            .sort((a: any, b: any) => {
                const au = a.name.includes("universal") ? 0 : 1;
                const bu = b.name.includes("universal") ? 0 : 1;
                if (au !== bu) return au - bu;
                const aa = a.name.includes("arm64") ? 0 : 1;
                const ba = b.name.includes("arm64") ? 0 : 1;
                return aa - ba;
            })[0];

        const downloadUrl = apkAsset?.browser_download_url || data.html_url;
        const changeLog = data.body
            ? data.body.split(/\r?\n/).filter((l: string) => l.trim())
            : ["新版本可用"];

        return {
            updateInfo: {
                needUpdate: true,
                data: {
                    version: latestVersion,
                    changeLog,
                    download: [downloadUrl],
                },
            },
        };
    } catch (e: any) {
        let msg;
        if (e?.code === "ECONNABORTED") {
            msg = "检查更新超时，请检查网络连接";
        } else if (e?.response?.status === 403) {
            msg = "GitHub API 请求受限，请稍后再试";
        } else if (e?.response?.status === 404) {
            msg = "未找到可用版本";
        } else {
            msg = "检查更新失败: " + (e?.message || "网络错误");
        }
        errorLog("检查更新失败", msg);
        return { error: msg };
    }
}
