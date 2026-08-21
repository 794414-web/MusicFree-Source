import React, { useState, useEffect, useRef } from "react";
import ThemeText from "@/components/base/themeText";
import { StyleSheet, View, ActivityIndicator } from "react-native";
import { ScrollView, TouchableOpacity } from "react-native-gesture-handler";
import rpx, { vh } from "@/utils/rpx";
import openUrl from "@/utils/openUrl";
import Clipboard from "@react-native-clipboard/clipboard";
import { hideDialog } from "../useDialog";
import Checkbox from "@/components/base/checkbox";
import Dialog from "./base";
import PersistStatus from "@/utils/persistStatus";
import { useI18N } from "@/core/i18n";
import { ApkUpdateModule, onApkUpdateEvent } from "@/native/apkUpdate";
import Toast from "@/utils/toast";
import { sizeFormatter } from "@/utils/fileUtils";

interface IDownloadDialogProps {
    version: string;
    content: string[];
    fromUrl: string;
    backUrl?: string;
}
export default function DownloadDialog(props: IDownloadDialogProps) {
    const { content, fromUrl, backUrl, version } = props;
    const [skipState, setSkipState] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [speed, setSpeed] = useState(0);
    const [downloadedBytes, setDownloadedBytes] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { t } = useI18N();

    /** 格式化网速 */
    const speedText =
        speed > 0 ? sizeFormatter(speed) + "/s" : "";

    /** 进度文本：有总量显示百分比，否则显示已下载体积 */
    const progressText =
        totalBytes > 0
            ? `${progress}%`
            : downloadedBytes > 0
              ? `已下载 ${sizeFormatter(downloadedBytes)}`
              : `0%`;

    const clearTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    // 清理定时器
    useEffect(() => {
        return clearTimer;
    }, []);

    // 监听安装事件
    useEffect(() => {
        const unsubscribe = onApkUpdateEvent(event => {
            if (event.type === "installing") {
                setDownloading(false);
                clearTimer();
                hideDialog();
            } else if (event.type === "error") {
                setDownloading(false);
                clearTimer();
                // 主链接失败，自动尝试备用链接
                if (!isBackupRef.current && backUrl) {
                    Toast.warn("下载失败，正在尝试备用链接...");
                    setTimeout(() => handleDownloadAndInstall(backUrl, true), 500);
                } else {
                    Toast.warn("更新失败: " + event.message);
                }
            }
        });
        return unsubscribe;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backUrl]);

    // 备用链接重入标记
    const isBackupRef = useRef(false);

    /** 直接下载并安装 */
    const handleDownloadAndInstall = async (url: string, isBackup = false) => {
        if (downloading) return;
        isBackupRef.current = isBackup;
        setDownloading(true);
        setProgress(0);
        setSpeed(0);
        setDownloadedBytes(0);
        setTotalBytes(0);
        PersistStatus.set("app.skipVersion", undefined);
        clearTimer();

        const tryBackup = (msg: string) => {
            if (!isBackup && backUrl) {
                Toast.warn(msg);
                setTimeout(() => handleDownloadAndInstall(backUrl, true), 500);
            } else {
                Toast.warn(msg);
            }
        };

        try {
            if (!ApkUpdateModule.isSupported()) {
                setDownloading(false);
                openUrl(url);
                Clipboard.setString(url);
                return;
            }

            await ApkUpdateModule.downloadAndInstall(url);

            let stalledCount = 0;
            let lastDownloaded = -1;
            let failedReported = false;
            const startTime = Date.now();
            const TOTAL_TIMEOUT_MS = 180_000;

            timerRef.current = setInterval(async () => {
                try {
                    const result = await ApkUpdateModule.getDownloadProgress();
                    const p = result?.progress ?? -1;

                    // 下载失败：返回 -1 且非备用，自动切换备用链接
                    if (p === -1) {
                        if (!failedReported) {
                            failedReported = true;
                            setDownloading(false);
                            clearTimer();
                            const err = await ApkUpdateModule.getLastError();
                            if (!isBackup && backUrl) {
                                tryBackup("下载失败，正在尝试备用链接...");
                            } else {
                                Toast.warn("下载失败: " + (err || "未知错误"));
                            }
                        }
                        return;
                    }

                    // 更新进度与网速
                    setProgress(p);
                    setSpeed(result?.speed ?? 0);
                    setDownloadedBytes(result?.downloadedBytes ?? 0);
                    setTotalBytes(result?.totalBytes ?? 0);

                    // 下载完成（进度 100 且文件校验通过），等待安装事件
                    if (p >= 100) {
                        clearTimer();
                        return;
                    }

                    // 总超时检测
                    if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
                        setDownloading(false);
                        clearTimer();
                        tryBackup("下载超时，正在尝试备用链接...");
                        return;
                    }

                    // 停滞检测：以字节数为基准，60 秒无增长则认为卡住
                    const dl = result?.downloadedBytes ?? 0;
                    if (dl === lastDownloaded) {
                        stalledCount++;
                        if (stalledCount >= 60) {
                            setDownloading(false);
                            clearTimer();
                            tryBackup("下载卡住，正在切换备用链接...");
                        }
                    } else {
                        stalledCount = 0;
                        lastDownloaded = dl;
                    }
                } catch (_) {}
            }, 1000);
        } catch (e: any) {
            setDownloading(false);
            clearTimer();
            tryBackup("下载启动失败: " + (e?.message || "未知错误"));
        }
    };

    return (
        <Dialog
            onDismiss={() => {
                if (skipState) {
                    PersistStatus.set("app.skipVersion", version);
                }
                hideDialog();
            }}>
            <Dialog.Title stringContent>{t("dialog.downloadDialog.title", {
                version: version,
            })}</Dialog.Title>
            <ScrollView style={style.scrollView}>
                {content?.map?.(_ => (
                    <ThemeText key={_} style={style.item}>
                        {_}
                    </ThemeText>
                ))}
            </ScrollView>

            {/* 下载进度条 */}
            {downloading && (
                <View style={style.progressContainer}>
                    <View style={style.progressRow}>
                        <ActivityIndicator size="small" />
                        <ThemeText style={style.progressText}>
                            {progressText}
                        </ThemeText>
                    </View>
                    <View style={style.progressTrack}>
                        <View style={[style.progressFill, { width: `${Math.min(progress, 100)}%` }]} />
                    </View>
                    {speedText ? (
                        <View style={style.speedRow}>
                            <ThemeText style={style.speedText}>
                                {speedText}
                            </ThemeText>
                        </View>
                    ) : null}
                </View>
            )}

            <Dialog.Actions style={style.dialogActions}>
                {!downloading && (
                    <TouchableOpacity
                        onPress={() => {
                            setSkipState(state => !state);
                        }}>
                        <View style={style.checkboxGroup}>
                            <Checkbox checked={skipState} />
                            <ThemeText style={style.checkboxHint}>
                                {t("dialog.downloadDialog.skipThisVersion")}
                            </ThemeText>
                        </View>
                    </TouchableOpacity>
                )}
                <View style={style.buttonGroup}>
                    <TouchableOpacity
                        style={style.button}
                        activeOpacity={0.6}
                        onPress={() => {
                            if (skipState) {
                                PersistStatus.set("app.skipVersion", version);
                            }
                            hideDialog();
                        }}>
                        <ThemeText style={style.buttonText}>
                            {t("common.cancel")}
                        </ThemeText>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={style.button}
                        activeOpacity={0.6}
                        onPress={() => handleDownloadAndInstall(fromUrl)}>
                        <ThemeText style={style.buttonText}>
                            {downloading ? "下载中" : "立即更新"}
                        </ThemeText>
                    </TouchableOpacity>
                    {backUrl && !downloading && (
                        <TouchableOpacity
                            style={style.button}
                            activeOpacity={0.6}
                            onPress={async () => {
                                PersistStatus.set("app.skipVersion", undefined);
                                openUrl(backUrl);
                                Clipboard.setString(backUrl);
                            }}>
                            <ThemeText style={style.buttonText}>
                                {t("dialog.downloadDialog.backupUrl")}
                            </ThemeText>
                        </TouchableOpacity>
                    )}
                </View>
            </Dialog.Actions>
        </Dialog>
    );
}

const style = StyleSheet.create({
    item: {
        marginBottom: rpx(20),
        lineHeight: rpx(36),
    },
    content: {
        flex: 1,
        maxHeight: vh(50),
    },
    scrollView: {
        maxHeight: vh(40),
        paddingHorizontal: rpx(26),
    },
    progressContainer: {
        paddingHorizontal: rpx(26),
        paddingVertical: rpx(16),
    },
    progressRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: rpx(12),
    },
    progressText: {
        marginLeft: rpx(12),
        fontSize: rpx(26),
    },
    progressTrack: {
        height: rpx(8),
        backgroundColor: "rgba(128,128,128,0.2)",
        borderRadius: rpx(4),
        overflow: "hidden",
    },
    speedRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: rpx(8),
    },
    speedText: {
        fontSize: rpx(22),
        opacity: 0.7,
    },
    progressFill: {
        height: "100%",
        backgroundColor: "#3b82f6",
        borderRadius: rpx(4),
    },
    dialogActions: {
        marginTop: rpx(24),
        height: rpx(120),
        marginBottom: rpx(12),
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
    },
    checkboxGroup: {
        flexDirection: "row",
        alignItems: "center",
    },
    buttonGroup: {
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        justifyContent: "flex-end",
    },
    checkboxHint: {
        marginLeft: rpx(12),
    },
    button: {
        paddingLeft: rpx(28),
        paddingVertical: rpx(14),
        marginLeft: rpx(16),
        alignItems: "center",
        justifyContent: "center",
    },
    buttonText: {
        fontSize: rpx(28),
    },
});
