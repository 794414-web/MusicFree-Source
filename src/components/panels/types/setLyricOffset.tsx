import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";

import PanelBase from "../base/panelBase";
import { iconSizeConst } from "@/constants/uiConst";
import { TouchableOpacity } from "react-native-gesture-handler";
import { hidePanel } from "../usePanel";
import useColors from "@/hooks/useColors";
import Icon from "@/components/base/icon.tsx";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import { useI18N } from "@/core/i18n";

interface IProps {
    musicItem: IMusic.IMusicItem;
    /** 点击回调 */
    onSubmit?: (offset: number) => void;
}

export default function SetLyricOffset(props: IProps) {
    const { musicItem, onSubmit } = props ?? {};
    const { t } = useI18N();

    const [offset, setOffset] = useState(
        getMediaExtraProperty(musicItem, "lyricOffset") ?? 0
    );

    const colors = useColors();

    let titleStr =
        offset === 0
            ? t("panel.setLyricOffset.normal")
            : offset < 0
                ? t("panel.setLyricOffset.delay", { time: (-offset).toFixed(1) })
                : t("panel.setLyricOffset.advance", { time: offset.toFixed(1) });

    return (
        <PanelBase
            height={rpx(520)}
            keyboardAvoidBehavior="none"
            renderBody={() => (
                <>
                    <View style={[styles.titleBar, { backgroundColor: colors.backdrop }]}>
                        <TouchableOpacity
                            style={styles.titleBtn}
                            onPress={hidePanel}>
                            <ThemeText fontWeight="medium">
                                {t("common.cancel")}
                            </ThemeText>
                        </TouchableOpacity>
                        <ThemeText
                            fontWeight="bold"
                            fontSize="title"
                            numberOfLines={1}
                            style={{ flex: 1, textAlign: "center" }}>
                            {t("panel.setLyricOffset.title", { status: titleStr })}
                        </ThemeText>
                        <View style={styles.titleBtn} />
                    </View>
                    <View style={styles.container}>
                        <TouchableOpacity
                            style={styles.btn}
                            onPress={() => {
                                setOffset(prev => prev - 0.2);
                            }}>
                            <Icon
                                name="minus"
                                size={iconSizeConst.big}
                                color={colors.text}
                            />
                            <ThemeText>-0.2s</ThemeText>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.btn}
                            onPress={() => {
                                setOffset(0);
                            }}>
                            <Icon
                                name="arrow-uturn-left"
                                size={iconSizeConst.big}
                                color={colors.text}
                            />
                            <ThemeText>{t("panel.setLyricOffset.reset")}</ThemeText>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.btn}
                            onPress={() => {
                                setOffset(prev => prev + 0.2);
                            }}>
                            <Icon
                                name="plus"
                                size={iconSizeConst.big}
                                color={colors.text}
                            />
                            <ThemeText>+0.2s</ThemeText>
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
                            onPress={hidePanel}>
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
                                onSubmit?.(offset);
                            }}>
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
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(24),
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(150,150,150,0.2)",
    },
    titleBtn: {
        width: rpx(120),
        height: "100%",
        justifyContent: "center",
    },
    header: {
        width: "100%",
        flexDirection: "row",
        padding: rpx(24),
    },
    container: {
        flex: 1,
        paddingHorizontal: rpx(24),
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
    },
    btn: {
        width: rpx(144),
        height: rpx(144),
        alignItems: "center",
        justifyContent: "space-around",
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
