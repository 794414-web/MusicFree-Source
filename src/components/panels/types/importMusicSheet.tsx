import ListItem from "@/components/base/listItem";
import { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import React from "react";
import { View } from "react-native";

import NoPlugin from "@/components/base/noPlugin";
import { showDialog } from "@/components/dialogs/useDialog";
import globalStyle from "@/constants/globalStyle";
import PluginManager from "@/core/pluginManager";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { showPanel } from "../usePanel";
import { useI18N } from "@/core/i18n";

export default function ImportMusicSheet() {
    const validPlugins = PluginManager.getSortedPluginsWithAbility("importMusicSheet");
    const { t } = useI18N();

    const safeAreaInsets = useSafeAreaInsets();

    /**
     * 统一歌单导入：自动识别歌单来源。
     * 依次尝试所有支持导入歌单的插件（GD音乐台优先），
     * 返回第一个非空结果，实现「任意歌单链接 -> 自动识别 -> 导入」。
     * 播放统一由 GD 音乐台负责（见 trackPlayer），导入来源仅用于拉取歌单。
     */
    const importPlaylist = async (urlLike: string) => {
        // GD音乐台作为统一聚合入口优先尝试
        const ordered = [
            ...validPlugins.filter(p => p.name === "GD音乐台"),
            ...validPlugins.filter(p => p.name !== "GD音乐台"),
        ];
        for (const plugin of ordered) {
            try {
                const result = await plugin.methods.importMusicSheet(urlLike);
                if (result && result.length > 0) {
                    return result;
                }
            } catch {
                // 单个插件识别/导入失败，继续尝试下一个
            }
        }
        return [];
    };

    return (
        <PanelBase
            height={vmax(60)}
            renderBody={() => (
                <>
                    <PanelHeader hideButtons title={t("panel.importMusicSheet.title")} />
                    {validPlugins.length ? (
                        <View style={globalStyle.fwflex1}>
                            <ListItem
                                withHorizontalPadding
                                onPress={() => {
                                    showPanel("SimpleInput", {
                                        title: t("panel.importMusicSheet.title"),
                                        placeholder: t("panel.importMusicSheet.placeholder"),
                                        hints: [t("panel.importMusicSheet.unifiedHint")],
                                        maxLength: 1000,
                                        async onOk(text, closePanel) {
                                            Toast.success(
                                                t("panel.importMusicSheet.importing"),
                                            );
                                            closePanel();
                                            const result = await importPlaylist(text);
                                            if (result.length > 0) {
                                                showDialog(
                                                    "SimpleDialog",
                                                    {
                                                        title: t("panel.importMusicSheet.prepareImport"),
                                                        content: t("panel.importMusicSheet.foundSongs", { count: result.length }),
                                                        onOk() {
                                                            showPanel(
                                                                "AddToMusicSheet",
                                                                {
                                                                    musicItem:
                                                                        result,
                                                                },
                                                            );
                                                        },
                                                    },
                                                );
                                            } else {
                                                Toast.warn(
                                                    t("panel.importMusicSheet.invalidLink"),
                                                );
                                            }
                                        },
                                    });
                                }}>
                                <ListItem.Content
                                    title={t("panel.importMusicSheet.title")}
                                    description={t("panel.importMusicSheet.entryDescription")}
                                />
                            </ListItem>
                        </View>
                    ) : (
                        <NoPlugin notSupportType={t("panel.importMusicSheet.title")} />
                    )}
                </>
            )}
        />
    );
}
