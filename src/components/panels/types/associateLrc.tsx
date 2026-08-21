import rpx, { vmax } from "@/utils/rpx";
import React, { useState } from "react";
import { StyleSheet, View, TouchableOpacity, TextInput } from "react-native";

import { fontSizeConst } from "@/constants/uiConst";
import lyricManager from "@/core/lyricManager";
import mediaCache from "@/core/mediaCache";
import useColors from "@/hooks/useColors";
import { errorLog } from "@/utils/log";
import { parseMediaUniqueKey } from "@/utils/mediaUtils";
import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import ThemeText from "@/components/base/themeText";
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

    async function handlePaste() {
        try {
            const content = await Clipboard.getString();
            if (content) {
                setInput(content);
                Toast.success(t("common.pasted"));
            } else {
                Toast.warn(t("common.clipboardEmpty"));
            }
        } catch {
            Toast.warn(t("common.pasteFail"));
        }
    }

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
                        <TouchableOpacity
                            style={[
                                style.pasteBtn,
                                { backgroundColor: colors.primary },
                            ]}
                            onPress={handlePaste}>
                            <ThemeText
                                fontWeight="medium"
                                color="#fff"
                                fontSize="subTitle">
                                {t("common.paste")}
                            </ThemeText>
                        </TouchableOpacity>
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
    pasteBtn: {
        height: rpx(72),
        paddingHorizontal: rpx(24),
        borderRadius: rpx(12),
        justifyContent: "center",
        alignItems: "center",
    },
});
