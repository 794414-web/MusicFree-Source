import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";

/**
 * 统一的"粘贴"按钮组件。
 *
 * 抽取自 simpleInput / createMusicSheet / associateLrc / setUserVariables
 * 四个面板组件中重复出现的"粘贴按钮"UI 实现,统一样式与文案。
 *
 * @param onPress 粘贴触发回调(通常调用 usePaste 返回的 paste 函数)
 * @param size 按钮尺寸规格,'normal' (默认, 高 88) | 'compact' (高 72, 用于紧凑面板)
 */
interface IPasteButtonProps {
    onPress: () => void;
    size?: "normal" | "compact";
}

export default function PasteButton(props: IPasteButtonProps) {
    const { onPress, size = "normal" } = props;
    const colors = useColors();
    const { t } = useI18N();

    return (
        <TouchableOpacity
            style={[
                styles.pasteBtn,
                size === "compact" && styles.pasteBtnCompact,
                { backgroundColor: colors.primary },
            ]}
            onPress={onPress}>
            <ThemeText
                fontWeight="medium"
                color="#fff"
                fontSize="subTitle">
                {t("common.paste")}
            </ThemeText>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    pasteBtn: {
        height: rpx(88),
        paddingHorizontal: rpx(24),
        borderRadius: rpx(12),
        justifyContent: "center",
        alignItems: "center",
    },
    pasteBtnCompact: {
        height: rpx(72),
        paddingHorizontal: rpx(24),
        borderRadius: rpx(12),
    },
});
