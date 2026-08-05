import axios from "axios";
import { compare } from "compare-versions";
import DeviceInfo from "react-native-device-info";
import { errorLog } from "@/utils/log";

const GITHUB_REPO = "794414-web/MusicFree-Source";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const GITHUB_API_BASE = `https://api.github.com`;
const REQUEST_TIMEOUT = 15000;

const checkUpdateAxios = axios.create({
    timeout: REQUEST_TIMEOUT,
    headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "MusicFree",
    },
});

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

function extractVersion(tagName: string): string {
    return tagName.replace(/^v/i, "");
}

function findDownloadUrls(release: IGitHubRelease): string[] {
    const apkAssets = (release.assets ?? []).filter(a =>
        a.name.toLowerCase().endsWith(".apk"),
    );

    if (apkAssets.length === 0) {
        return [release.html_url];
    }

    const sortedAssets = [...apkAssets].sort((a, b) => {
        const au = a.name.toLowerCase().includes("universal") ? 0 : 1;
        const bu = b.name.toLowerCase().includes("universal") ? 0 : 1;
        if (au !== bu) return au - bu;
        const aa = a.name.toLowerCase().includes("arm64") ? 0 : 1;
        const ba = b.name.toLowerCase().includes("arm64") ? 0 : 1;
        return aa - ba;
    });

    return sortedAssets.map(a => a.browser_download_url);
}

function buildUpdateInfo(release: IGitHubRelease, currentVersion: string): IUpdateInfo | null {
    const latestVersion = extractVersion(release.tag_name);
    if (!compare(latestVersion, currentVersion, ">")) {
        return null;
    }

    const downloadUrls = findDownloadUrls(release);
    const changeLog = release.body
        ? release.body.split(/\r?\n/).filter(line => line.trim())
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

async function testGitHubApi(): Promise<{ ok: boolean; message: string }> {
    try {
        const response = await checkUpdateAxios.get(GITHUB_API_BASE);
        const ok = response.status >= 200 && response.status < 400;
        return {
            ok,
            message: ok ? "GitHub API 可访问" : `GitHub API 返回异常: HTTP ${response.status}`,
        };
    } catch (e: any) {
        if (e?.code === "ECONNABORTED") {
            return { ok: false, message: "GitHub API 连接超时" };
        }
        if (e?.response) {
            return {
                ok: false,
                message: `GitHub API 返回异常: HTTP ${e.response.status}`,
            };
        }
        return {
            ok: false,
            message: `无法访问 GitHub API: ${e?.message || "未知错误"}`,
        };
    }
}

async function fetchLatestRelease(): Promise<IGitHubRelease> {
    const response = await checkUpdateAxios.get(GITHUB_API);
    if (response.status !== 200) {
        const err: any = new Error(`HTTP ${response.status}`);
        err.response = { status: response.status };
        throw err;
    }
    return response.data as IGitHubRelease;
}

async function fetchReleasesList(): Promise<IGitHubRelease[]> {
    const response = await checkUpdateAxios.get(GITHUB_RELEASES_API);
    if (response.status !== 200) {
        const err: any = new Error(`HTTP ${response.status}`);
        err.response = { status: response.status };
        throw err;
    }
    return response.data as IGitHubRelease[];
}

export default async function checkUpdate(): Promise<ICheckUpdateResult> {
    const currentVersion = DeviceInfo.getVersion();

    try {
        let release: IGitHubRelease | null = null;

        try {
            release = await fetchLatestRelease();
        } catch (e: any) {
            if (e?.code === "ECONNABORTED") {
                return { error: "检查更新超时，请检查网络连接" };
            }
        }

        if (!release) {
            const diag = await testGitHubApi();
            if (!diag.ok) {
                errorLog("检查更新失败 - 网络诊断", diag.message);
                return { error: diag.message };
            }

            const releases = await fetchReleasesList();
            if (!releases?.length) {
                return { error: "暂无可用版本" };
            }
            release = releases[0];
        }

        if (!release?.tag_name) {
            return { error: "无法获取版本信息" };
        }

        const updateInfo = buildUpdateInfo(release, currentVersion);
        if (updateInfo) {
            return { updateInfo };
        }

        return {};
    } catch (e: any) {
        let msg: string;
        if (e?.code === "ECONNABORTED") {
            msg = "检查更新超时，请检查网络连接";
        } else if (e?.response?.status === 403) {
            msg = "GitHub API 请求受限，请稍后再试";
        } else if (e?.response?.status === 404) {
            msg = "未找到可用版本";
        } else if (e?.response?.status) {
            msg = `检查更新失败: HTTP ${e.response.status}`;
        } else {
            msg = e?.message ? `网络错误: ${e.message}` : "网络错误";
        }
        errorLog("检查更新失败", msg);
        return { error: msg };
    }
}
