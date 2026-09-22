import { fontSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import usePaste from "@/hooks/usePaste";
import rpx, { vmax } from "@/utils/rpx";
import React, { useState } from "react";
import { StyleSheet, View, TextInput, TouchableOpacity } from "react-native";

import MusicSheet from "@/core/musicSheet";
import PasteButton from "@/components/base/pasteButton";
import ThemeText from "@/components/base/themeText";
import PanelBase from "../base/panelBase";
import { hidePanel } from "../usePanel";
import { useI18N } from "@/core/i18n";

interface ICreateMusicSheetProps {
    defaultName?: string;
    onSheetCreated?: (sheetId: string) => void;
    onCancel?: () => void;
}

export default function CreateMusicSheet(props: ICreateMusicSheetProps) {
    const { t } = useI18N();

    const { onSheetCreated, onCancel, defaultName = t("panel.createMusicSheet.title") } = props;

    const [input, setInput] = useState("");
    const colors = useColors();
    // 统一的粘贴函数,内部已封装 Clipboard 读取 + Toast 提示
    const paste = usePaste();

    const handleOk = async () => {
        const sheetId = await MusicSheet.addSheet(
            input || defaultName,
        );
        onSheetCreated?.(sheetId);
        hidePanel();
    };

    return (
        <PanelBase
            height={vmax(30)}
            keyboardAvoidBehavior="height"
            renderBody={() => (
                <>
                    <View style={[styles.titleBar, { backgroundColor: colors.backdrop }]}>
                        <ThemeText
                            fontWeight="bold"
                            fontSize="title"
                            numberOfLines={1}>
                            {t("panel.createMusicSheet.title")}
                        </ThemeText>
                    </View>
                    <View style={styles.inputRow}>
                        <TextInput
                            value={input}
                            onChangeText={_ => {
                                setInput(_);
                            }}
                            autoFocus
                            accessible
                            accessibilityLabel={t("panel.createMusicSheet.inputLabel")}
                            accessibilityHint={t("panel.createMusicSheet.title")}
                            style={[
                                styles.input,
                                {
                                    color: colors.text,
                                    backgroundColor: colors.placeholder,
                                },
                            ]}
                            placeholderTextColor={colors.textSecondary}
                            placeholder={defaultName}
                            maxLength={200}
                        />
                        <PasteButton
                            size="compact"
                            onPress={() => paste(setInput)}
                        />
                        <TouchableOpacity
                            style={[
                                styles.confirmBtn,
                                { backgroundColor: colors.primary },
                            ]}
                            onPress={handleOk}>
                            <ThemeText
                                fontWeight="medium"
                                color="#fff"
                                fontSize="subTitle">
                                {t("common.confirm")}
                            </ThemeText>
                        </TouchableOpacity>
                    </View>
                    <View
                        style={[
                            styles.bottomBar,
                            { backgroundColor: colors.backdrop },
                        ]}>
                        <TouchableOpacity
                            style={[
                                styles.bottomBtn,
                                { borderColor: colors.divider },
                            ]}
                            onPress={() => {
                                onCancel ? onCancel() : hidePanel();
                            }}>
                            <ThemeText fontWeight="medium">
                                {t("common.cancel")}
                            </ThemeText>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.bottomBtn,
                                { backgroundColor: colors.primary },
                            ]}
                            onPress={handleOk}>
                            <ThemeText
                                fontWeight="medium"
                                color="#fff">
                                {t("common.confirm")}
                            </ThemeText>
                        </TouchableOpacity>
                    </View>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    titleBar: {
        width: "100%",
        height: rpx(100),
        alignItems: "center",
        justifyContent: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(150,150,150,0.2)",
    },
    inputRow: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: rpx(24),
        marginVertical: rpx(24),
    },
    input: {
        flex: 1,
        borderRadius: rpx(12),
        fontSize: fontSizeConst.content,
        lineHeight: fontSizeConst.content * 1.5,
        padding: rpx(12),
        marginRight: rpx(16),
    },
    confirmBtn: {
        height: rpx(88),
        paddingHorizontal: rpx(28),
        borderRadius: rpx(12),
        justifyContent: "center",
        alignItems: "center",
        marginLeft: rpx(12),
    },
    bottomBar: {
        flexShrink: 0,
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(150,150,150,0.2)",
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
        paddingBottom: rpx(48),
    },
    bottomBtn: {
        flex: 1,
        height: rpx(88),
        borderRadius: rpx(44),
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        marginHorizontal: rpx(12),
    },
});
