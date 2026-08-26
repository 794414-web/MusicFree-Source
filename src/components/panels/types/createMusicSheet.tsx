import { fontSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import usePaste from "@/hooks/usePaste";
import rpx, { vmax } from "@/utils/rpx";
import React, { useState } from "react";
import { StyleSheet, View, TextInput } from "react-native";

import MusicSheet from "@/core/musicSheet";
import PasteButton from "@/components/base/pasteButton";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
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

    return (
        <PanelBase
            height={vmax(30)}
            keyboardAvoidBehavior="height"
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("panel.createMusicSheet.title")}
                        onCancel={() => {
                            onCancel ? onCancel() : hidePanel();
                        }}
                        onOk={async () => {
                            const sheetId = await MusicSheet.addSheet(
                                input || defaultName,
                            );
                            onSheetCreated?.(sheetId);
                            hidePanel();
                        }}
                    />
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
                    </View>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
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
});
