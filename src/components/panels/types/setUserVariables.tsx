import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, View, TouchableOpacity, TextInput } from "react-native";
import rpx, { vmax } from "@/utils/rpx";
import useColors from "@/hooks/useColors";

import ThemeText from "@/components/base/themeText";
import Clipboard from "@react-native-clipboard/clipboard";
import Toast from "@/utils/toast";
import { ScrollView } from "react-native-gesture-handler";
import PanelBase from "../base/panelBase";
import { hidePanel } from "../usePanel";
import ListItem from "@/components/base/listItem";
import globalStyle from "@/constants/globalStyle";
import PanelHeader from "../base/panelHeader";
import { useI18N } from "@/core/i18n";

interface IUserVariablesProps {
    title?: string;
    onOk: (values: Record<string, string>, closePanel: () => void) => void;
    variables: IPlugin.IUserVariable[];
    initValues?: Record<string, string>;
    onCancel?: () => void;
}

export default function SetUserVariables(props: IUserVariablesProps) {
    const { onOk, onCancel, variables, initValues = {}, title } = props;

    const colors = useColors();
    const { t } = useI18N();

    const resultRef = useRef({ ...initValues });
    const [values, setValues] = useState<Record<string, string>>({ ...initValues });

    async function handlePaste(key: string) {
        try {
            const content = await Clipboard.getString();
            if (content) {
                resultRef.current[key] = content;
                setValues(prev => ({ ...prev, [key]: content }));
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
            height={vmax(80)}
            positionMethod='top'
            keyboardAvoidBehavior='none'
            renderBody={() => (
                <>
                    <PanelHeader
                        title={title ?? "设置用户变量"}
                        onCancel={() => {
                            onCancel?.();
                            hidePanel();
                        }}
                        onOk={async () => {
                            onOk(resultRef.current, hidePanel);
                        }}
                    />
                    <KeyboardAvoidingView
                        behavior="padding"
                        style={globalStyle.flex1}>
                        <ScrollView
                            contentContainerStyle={{
                                paddingBottom: vmax(20),
                            }}>
                            {variables.map(it => (
                                <ListItem
                                    key={it.key}
                                    withHorizontalPadding
                                    style={styles.listItem}>
                                    <ThemeText
                                        numberOfLines={1}
                                        ellipsizeMode="tail"
                                        style={styles.varName}>
                                        {it.name ?? it.key}
                                    </ThemeText>
                                    <View style={styles.fieldRow}>
                                        <View style={styles.inputWrapper}>
                                            <TextInput
                                                value={values[it.key] ?? ""}
                                                onChangeText={e => {
                                                    resultRef.current[it.key] = e;
                                                    setValues(prev => ({
                                                        ...prev,
                                                        [it.key]: e,
                                                    }));
                                                }}
                                                style={[
                                                    styles.input,
                                                    {
                                                        color: colors.text,
                                                        backgroundColor:
                                                            colors.placeholder,
                                                    },
                                                ]}
                                                placeholder={it.hint}
                                                placeholderTextColor={colors.textSecondary}
                                            />
                                        </View>
                                        <TouchableOpacity
                                            style={[
                                                styles.pasteBtn,
                                                { backgroundColor: colors.primary },
                                            ]}
                                            onPress={() => handlePaste(it.key)}>
                                            <ThemeText
                                                fontWeight="medium"
                                                color="#fff"
                                                fontSize="subTitle">
                                                {t("common.paste")}
                                            </ThemeText>
                                        </TouchableOpacity>
                                    </View>
                                </ListItem>
                            ))}
                        </ScrollView>
                    </KeyboardAvoidingView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    listItem: {
        justifyContent: "space-between",
    },
    varName: {
        maxWidth: "30%",
    },
    fieldRow: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        marginLeft: rpx(16),
    },
    inputWrapper: {
        flex: 1,
    },
    input: {
        width: "100%",
        paddingVertical: rpx(10),
        paddingHorizontal: rpx(14),
        borderRadius: rpx(8),
        fontSize: rpx(28),
    },
    pasteBtn: {
        height: rpx(64),
        paddingHorizontal: rpx(18),
        borderRadius: rpx(8),
        justifyContent: "center",
        alignItems: "center",
        marginLeft: rpx(12),
    },
});
