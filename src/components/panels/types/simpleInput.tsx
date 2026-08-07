import React, { useState, useRef, useEffect } from "react";
import { StyleSheet, View, TouchableOpacity, TextInput } from "react-native";
import rpx, { vh } from "@/utils/rpx";
import { fontSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";

import ThemeText from "@/components/base/themeText";
import { ScrollView } from "react-native-gesture-handler";
import Clipboard from "@react-native-clipboard/clipboard";
import Toast from "@/utils/toast";
import PanelBase from "../base/panelBase";
import { hidePanel } from "../usePanel";
import { useI18N } from "@/core/i18n";

interface ISimpleInputProps {
    title?: string;
    onOk: (text: string, closePanel: () => void) => void;
    hints?: string[];
    onCancel?: () => void;
    maxLength?: number;
    placeholder?: string;
    autoFocus?: boolean;
    defaultValue?: string;
}

export default function SimpleInput(props: ISimpleInputProps) {
    const { t } = useI18N();
    const {
        onOk,
        onCancel,
        placeholder,
        maxLength = 80,
        hints,
        title,
        autoFocus = true,
        defaultValue,
    } = props;

    const [input, setInput] = useState(defaultValue ?? "");
    const colors = useColors();
    const inputRef = useRef<TextInput>(null);
    const hasFocusedRef = useRef(false);

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
            keyboardAvoidBehavior="padding"
            height={vh(60)}
            renderBody={(loading) => {
                if (!loading && autoFocus && !hasFocusedRef.current) {
                    hasFocusedRef.current = true;
                    setTimeout(() => inputRef.current?.focus(), 100);
                }
                return (
                <View style={styles.container}>
                    <ScrollView
                        style={styles.scrollArea}
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator>
                        {title ? (
                            <View style={styles.titleBar}>
                                <ThemeText
                                    style={styles.title}
                                    fontWeight="bold"
                                    fontSize="title">
                                    {title}
                                </ThemeText>
                            </View>
                        ) : null}

                        <View style={styles.inputRow}>
                            <TextInput
                                ref={inputRef}
                                value={input}
                                accessible
                                autoFocus={autoFocus && !loading}
                                accessibilityLabel={t("panel.simpleInput.inputLabel")}
                                accessibilityHint={placeholder}
                                onChangeText={_ => {
                                    setInput(_);
                                }}
                                style={[
                                    styles.input,
                                    {
                                        color: colors.text,
                                        backgroundColor: colors.placeholder,
                                    },
                                ]}
                                placeholderTextColor={colors.textSecondary}
                                placeholder={placeholder ?? ""}
                                maxLength={maxLength}
                            />
                            <TouchableOpacity
                                style={[
                                    styles.pasteBtn,
                                    { backgroundColor: colors.placeholder },
                                ]}
                                onPress={handlePaste}>
                                <ThemeText
                                    fontWeight="medium"
                                    fontSize="subTitle">
                                    {t("common.paste")}
                                </ThemeText>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.confirmBtn,
                                    { backgroundColor: colors.primary },
                                ]}
                                onPress={() => {
                                    onOk(input, hidePanel);
                                }}>
                                <ThemeText
                                    fontWeight="medium"
                                    fontColor="white"
                                    fontSize="subTitle">
                                    {t("common.confirm")}
                                </ThemeText>
                            </TouchableOpacity>
                        </View>

                        {hints?.length ? (
                            <View style={styles.hints}>
                                {hints.map((_, index) => (
                                    <ThemeText
                                        key={`hint-index-${index}`}
                                        style={styles.hintLine}
                                        fontSize="subTitle"
                                        fontColor="textSecondary">
                                        ￮ {_}
                                    </ThemeText>
                                ))}
                            </View>
                        ) : null}
                    </ScrollView>

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
                                onCancel?.();
                                hidePanel();
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
                            onPress={() => {
                                onOk(input, hidePanel);
                            }}>
                            <ThemeText
                                fontWeight="medium"
                                fontColor="white">
                                {t("common.confirm")}
                            </ThemeText>
                        </TouchableOpacity>
                    </View>
                </View>
            );}}
        />
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: "column",
    },
    scrollArea: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: rpx(24),
    },
    titleBar: {
        width: "100%",
        minHeight: rpx(100),
        alignItems: "center",
        justifyContent: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(150,150,150,0.2)",
        paddingVertical: rpx(16),
    },
    title: {
        textAlign: "center",
    },
    inputRow: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: rpx(24),
        marginTop: rpx(24),
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
        height: rpx(88),
        paddingHorizontal: rpx(24),
        borderRadius: rpx(12),
        justifyContent: "center",
        alignItems: "center",
        marginRight: rpx(12),
    },
    confirmBtn: {
        height: rpx(88),
        paddingHorizontal: rpx(28),
        borderRadius: rpx(12),
        justifyContent: "center",
        alignItems: "center",
    },
    hints: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    hintLine: {
        marginBottom: rpx(12),
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
