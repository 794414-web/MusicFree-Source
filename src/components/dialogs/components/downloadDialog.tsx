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
    /** 新增：2.0.9 起透传完整 download[] 数组，原生端支持按顺序自动回退 */
    downloadUrls?: string[];
    fromUrl: string;
    backUrl?: string;
}
export default function DownloadDialog(props: IDownloadDialogProps) {
    const { content, fromUrl, backUrl, version, downloadUrls = [] } = props;
    // 最终传给原生端的有序链接列表：downloadUrls 优先，否则回退到 fromUrl+backUrl
    const effectiveUrls = Array.isArray(downloadUrls) && downloadUrls.length > 0
        ? downloadUrls
        : [fromUrl, backUrl].filter((u): u is string => !!u);
    const firstUrl = effectiveUrls[0] ?? fromUrl;
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
            } else if (event.type === "fallback") {
                // 静默：原生正在自动切换链路，这里只 Toast 提示让用户看到切换过程
                Toast.warn(event.message || "正在切换下载源...");
            } else if (event.type === "error") {
                setDownloading(false);
                clearTimer();
                // 2.0.9 起原生端已经按 download[] 顺序自动回退到过了，这里只负责最终失败展示
                Toast.warn("更新失败: " + event.message);
            }
        });
        return unsubscribe;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 备用链接重入标记
    const isBackupRef = useRef(false);

    /** 直接下载并安装：把 3+ 条候选链接以 JSON 数组传给原生，原生按顺序自动回退 */
    const handleDownloadAndInstall = async (urls: string | string[], isBackup = false) => {
        if (downloading) return;
        isBackupRef.current = isBackup;
        setDownloading(true);
        setProgress(0);
        setSpeed(0);
        setDownloadedBytes(0);
        setTotalBytes(0);
        PersistStatus.set("app.skipVersion", undefined);
        clearTimer();

        const normalizeInput = (): string => {
            if (Array.isArray(urls)) {
                return JSON.stringify(urls.filter(u => typeof u === "string" && u.length > 0));
            }
            return urls;
        };

        try {
            if (!ApkUpdateModule.isSupported()) {
                setDownloading(false);
                const primary = Array.isArray(urls) ? urls[0] : urls;
                openUrl(primary);
                Clipboard.setString(primary);
                return;
            }

            await ApkUpdateModule.downloadAndInstall(normalizeInput());

            let stalledCount = 0;
            let lastDownloaded = -1;
            let failedReported = false;
            // 把「链路切换」也计入总超时：给每条链路留 2 分钟最低窗口，总体 6 分钟上限
            const startTime = Date.now();
            const TOTAL_TIMEOUT_MS = Math.max(360_000, effectiveUrls.length * 120_000);

            timerRef.current = setInterval(async () => {
                try {
                    const result = await ApkUpdateModule.getDownloadProgress();
                    const p = result?.progress ?? -1;

                    // 下载完成（进度 100 且文件校验通过），等待安装事件
                    if (p >= 100) {
                        clearTimer();
                        return;
                    }

                    // 下载失败/空闲：progress === -1 时交由 error 事件通知最终失败
                    // （native 内部已回退下一条）不要在这里再次切链路
                    if (p === -1) {
                        return;
                    }

                    // 更新进度与网速
                    setProgress(p);
                    setSpeed(result?.speed ?? 0);
                    setDownloadedBytes(result?.downloadedBytes ?? 0);
                    setTotalBytes(result?.totalBytes ?? 0);

                    // 总超时检测
                    if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
                        if (!failedReported) {
                            failedReported = true;
                            setDownloading(false);
                            clearTimer();
                            Toast.warn("下载超时：所有链路在限定时间内均未完成");
                        }
                        return;
                    }

                    // 停滞检测：以字节数为基准，120 秒无增长才判定卡住（国内代理不稳定，给足缓冲）
                    const dl = result?.downloadedBytes ?? 0;
                    if (dl === lastDownloaded) {
                        stalledCount++;
                        if (stalledCount >= 120) {
                            if (!failedReported) {
                                failedReported = true;
                                setDownloading(false);
                                clearTimer();
                                Toast.warn("下载卡住超过 2 分钟，已停止。可稍后重试");
                            }
                            return;
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
            Toast.warn("下载启动失败: " + (e?.message || "未知错误"));
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
                        onPress={() => handleDownloadAndInstall(effectiveUrls)}>
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
                                // 2.0.9 起如果有完整链接列表，优先兜底打开「最后一条」（通常是 GitHub 源站或 jsdelivr）
                                const fallbackUrl = (downloadUrls?.length && downloadUrls[downloadUrls.length - 1]) || backUrl;
                                openUrl(fallbackUrl);
                                Clipboard.setString(fallbackUrl);
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
