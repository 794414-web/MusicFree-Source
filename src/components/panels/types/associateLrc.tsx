import rpx, { vmax } from "@/utils/rpx";
import React, { useState } from "react";
import { StyleSheet, View, TextInput } from "react-native";

import { fontSizeConst } from "@/constants/uiConst";
import lyricManager from "@/core/lyricManager";
import mediaCache from "@/core/mediaCache";
import useColors from "@/hooks/useColors";
import usePaste from "@/hooks/usePaste";
import { errorLog } from "@/utils/log";
import { parseMediaUniqueKey } from "@/utils/mediaUtils";
import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import PasteButton from "@/components/base/pasteButton";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel } from "../usePanel";
import { useI18N } from "@/core/i18n";

interface INewMusicSheetProps {
    musicItem: IMusic.IMusicItem;
}

export default function AssociateLrc(props: INewMusicSheetProps) {
    const { musicItem } = props;

    const [input, setInput] = useState("");
    const colors = useColors();
    const { t } = useI18N();
    // 统一的粘贴函数,内部已封装 Clipboard 读取 + Toast 提示
    const paste = usePaste();

    return (
        <PanelBase
            keyboardAvoidBehavior="height"
            height={vmax(30)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("panel.associateLrc.title")}
                        onCancel={hidePanel}
                        onOk={async () => {
                            const inputValue =
                                input ?? (await Clipboard.getString());
                            if (inputValue) {
                                try {
                                    const targetMedia = parseMediaUniqueKey(
                                        inputValue.trim(),
                                    );
                                    const targetCache =
                                        mediaCache.getMediaCache(targetMedia);
                                    if (!targetCache) {
                                        Toast.warn(
                                            t("panel.associateLrc.targetExpired"),
                                        );
                                        throw new Error("CLIPBOARD TIMEOUT");
                                    }

                                    lyricManager.associateLyric(musicItem, {
                                        ...targetMedia,
                                        ...targetCache,
                                    });
                                    Toast.success(t("panel.associateLrc.toast.success"));
                                    hidePanel();
                                } catch (e: any) {
                                    if (e.message !== "CLIPBOARD TIMEOUT") {
                                        Toast.warn(t("panel.associateLrc.toast.fail"));
                                    }
                                    errorLog("关联歌词失败", e?.message);
                                }
                            } else {
                                lyricManager.unassociateLyric(musicItem);
                                Toast.success(t("panel.associateLrc.toast.unlinkSuccess"));
                                hidePanel();
                            }
                        }}
                    />

                    <View style={style.inputRow}>
                        <TextInput
                            value={input}
                            onChangeText={_ => {
                                setInput(_);
                            }}
                            style={[
                                style.input,
                                {
                                    color: colors.text,
                                    backgroundColor: colors.placeholder,
                                },
                            ]}
                            placeholderTextColor={colors.textSecondary}
                            placeholder={t("panel.associateLrc.inputPlaceholder")}
                            maxLength={80}
                        />
                        <PasteButton
                            size="compact"
                            onPress={() => paste(setInput)}
                        />
                    </View>
                </>
            )}
        />
    );
}

const style = StyleSheet.create({
    inputRow: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: rpx(24),
    },
    input: {
        flex: 1,
        borderRadius: rpx(12),
        fontSize: fontSizeConst.content,
        lineHeight: fontSizeConst.content * 1.5,
        padding: rpx(12),
        marginRight: rpx(16),
    },
});
