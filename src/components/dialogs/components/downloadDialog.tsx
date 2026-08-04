import React, { useState, useEffect, useRef } from "react";
import ThemeText from "@/components/base/themeText";
import { StyleSheet, View, ActivityIndicator } from "react-native";
import rpx, { vh } from "@/utils/rpx";
import openUrl from "@/utils/openUrl";
import Clipboard from "@react-native-clipboard/clipboard";
import { ScrollView, TouchableOpacity } from "react-native-gesture-handler";
import { hideDialog } from "../useDialog";
import Checkbox from "@/components/base/checkbox";
import Button from "@/components/base/textButton.tsx";
import Dialog from "./base";
import PersistStatus from "@/utils/persistStatus";
import { useI18N } from "@/core/i18n";
import { ApkUpdateModule, onApkUpdateEvent } from "@/native/apkUpdate";
import Toast from "@/utils/toast";
import { Log } from "@/utils/log";

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
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { t } = useI18N();

    // 清理定时器
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    // 监听安装事件
    useEffect(() => {
        const unsubscribe = onApkUpdateEvent(event => {
            if (event.type === "installing") {
                setDownloading(false);
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
                hideDialog();
            } else if (event.type === "error") {
                setDownloading(false);
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
                Toast.warn("更新失败: " + event.message);
            }
        });
        return unsubscribe;
    }, []);

    /** 直接下载并安装 */
    const handleDownloadAndInstall = async (url: string) => {
        PersistStatus.set("app.skipVersion", undefined);

        try {
            if (!ApkUpdateModule.isSupported()) {
                openUrl(url);
                Clipboard.setString(url);
                return;
            }

            setDownloading(true);
            setProgress(0);
            Log.d("开始下载 APK: " + url);

            const downloadId = await ApkUpdateModule.downloadAndInstall(url);
            Log.d("下载已启动, downloadId=" + downloadId);

            let stalledCount = 0;
            let lastProgress = -1;
            let failedReported = false;

            timerRef.current = setInterval(async () => {
                try {
                    const p = await ApkUpdateModule.getDownloadProgress();
                    
                    if (p === -1) {
                        if (!failedReported) {
                            failedReported = true;
                            setDownloading(false);
                            if (timerRef.current) {
                                clearInterval(timerRef.current);
                                timerRef.current = null;
                            }
                            const err = await ApkUpdateModule.getLastError();
                            Toast.warn("下载失败: " + (err || "未知错误"));
                        }
                        return;
                    }

                    if (p >= 0) {
                        setProgress(p);
                    }

                    if (p >= 100) {
                        if (timerRef.current) {
                            clearInterval(timerRef.current);
                            timerRef.current = null;
                        }
                        return;
                    }

                    if (p === lastProgress) {
                        stalledCount++;
                        if (stalledCount >= 60) {
                            if (timerRef.current) {
                                clearInterval(timerRef.current);
                                timerRef.current = null;
                            }
                            setDownloading(false);
                            Toast.warn("下载速度过慢，请尝试备用链接");
                        }
                    } else {
                        stalledCount = 0;
                        lastProgress = p;
                    }
                } catch (_) {}
            }, 500);
        } catch (e: any) {
            setDownloading(false);
            const msg = e?.message || "未知错误";
            Log.e("下载启动失败: " + msg);
            Toast.warn("下载启动失败: " + msg);
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
                            正在下载... {progress}%
                        </ThemeText>
                    </View>
                    <View style={style.progressTrack}>
                        <View style={[style.progressFill, { width: `${progress}%` }]} />
                    </View>
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
                    <Button
                        style={style.button}
                        onPress={() => {
                            if (skipState) {
                                PersistStatus.set("app.skipVersion", version);
                            }
                            hideDialog();
                        }}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        style={style.button}
                        onPress={() => handleDownloadAndInstall(fromUrl)}
                        disabled={downloading}
                    >
                        {downloading ? "下载中" : "立即更新"}
                    </Button>
                    {backUrl && !downloading && (
                        <Button
                            style={style.button}
                            onPress={async () => {
                                PersistStatus.set("app.skipVersion", undefined);
                                openUrl(backUrl);
                                Clipboard.setString(backUrl);
                            }}>
                            {t("dialog.downloadDialog.backupUrl")}
                        </Button>
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
        alignItems: "flex-end",
    },
});
