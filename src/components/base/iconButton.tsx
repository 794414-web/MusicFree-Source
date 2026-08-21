import React from "react";
import { ColorKey, colorMap, iconSizeConst } from "@/constants/uiConst";
import { StyleSheet, TouchableOpacity } from "react-native";
import useColors from "@/hooks/useColors";
import { SvgProps } from "react-native-svg";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import rpx from "@/utils/rpx";

interface IIconButtonProps extends SvgProps {
    name: IIconName;
    style?: SvgProps["style"];
    sizeType?: keyof typeof iconSizeConst;
    fontColor?: ColorKey;
    color?: string;
    onPress?: () => void;
    accessibilityLabel?: string;
}

export default function IconButton(props: IIconButtonProps) {
    const {
        sizeType = "normal",
        fontColor = "normal",
        style,
        color,
        onPress,
        accessibilityLabel,
    } = props;
    const colors = useColors();
    const size = iconSizeConst[sizeType];

    // 注意：SVG 图标本身不响应 onPress，若不包裹触摸容器，点击会毫无反应
    // （例如首页“新建歌单 / 导入歌单”按钮）。这里在存在 onPress 时用 RN 核心
    // TouchableOpacity 包裹图标。
    // 关键经验：首页 ScrollView 必须使用 RN 核心 ScrollView（不能用 gesture-handler
    // 的 ScrollView，其 NativeViewGestureHandler 会拦截子组件触摸）；同时，在核心
    // ScrollView 内部，也必须使用 RN 核心的 Touchable（核心 Pressable/TouchableOpacity
    // 均正常响应，与搜索栏、ListItem 一致）。实测 gesture-handler 的 Touchable 在核心
    // ScrollView 内会完全失去点击响应，故此处必须用核心组件。
    if (onPress) {
        const { onPress: _ignoredOnPress, accessibilityLabel: _ignoredLabel, ...iconProps } = props;
        return (
            <TouchableOpacity
                onPress={onPress}
                style={[
                    styles.pressable,
                    { width: size + rpx(24), height: size + rpx(24) },
                ]}>
                <Icon
                    {...iconProps}
                    color={color ?? colors[colorMap[fontColor]]}
                    style={[{ minWidth: size }, style]}
                    size={size}
                />
            </TouchableOpacity>
        );
    }

    return (
        <Icon
            {...props}
            color={color ?? colors[colorMap[fontColor]]}
            style={[{ minWidth: size }, styles.textCenter, style]}
            size={size}
        />
    );
}

const styles = StyleSheet.create({
    textCenter: {
        height: "100%",
        textAlignVertical: "center",
    },
    pressable: {
        alignItems: "center",
        justifyContent: "center",
    },
});
