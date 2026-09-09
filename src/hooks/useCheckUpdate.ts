import { showDialog } from "@/components/dialogs/useDialog";
import PersistStatus from "@/utils/persistStatus";
import checkUpdate from "@/utils/checkUpdate";
import Toast from "@/utils/toast";
import { compare } from "compare-versions";
import { useEffect } from "react";
import i18n from "@/core/i18n";

export const checkUpdateAndShowResult = (
    showToast = false,
    checkSkip = false,
) => {
    checkUpdate().then(result => {
        const { updateInfo, error } = result ?? {};
        if (error) {
            if (showToast) {
                Toast.warn(error);
            }
            return;
        }
        if (updateInfo?.needUpdate) {
            const { data } = updateInfo;
            const skipVersion = PersistStatus.get("app.skipVersion");
            if (!Array.isArray(data.download) || data.download.length === 0) {
                if (showToast) {
                    Toast.warn("发现新版本，但没有可用下载地址");
                }
                return;
            }
            if (
                checkSkip &&
                skipVersion &&
                compare(skipVersion, data.version, ">=")
            ) {
                return;
            }
            showDialog("DownloadDialog", {
                version: data.version,
                content: data.changeLog,
                // 2026-09 v2.0.9 起原生端支持「按 download[] 顺序自动回退」，
                // 这里直接透传全部候选链接（按国内可达优先排序在 release/version.json）
                downloadUrls: data.download ?? [],
                // 兼容 props 保留：
                fromUrl: data.download[0],
                backUrl: data.download[1],
            });
        } else {
            if (showToast) {
                Toast.success(i18n.t("checkUpdate.error.latestVersion"));
            }
        }
    });
};

export default function (callOnMount = true) {
    useEffect(() => {
        if (callOnMount) {
            checkUpdateAndShowResult(false, true);
        }
    }, []);

    return checkUpdateAndShowResult;
}
