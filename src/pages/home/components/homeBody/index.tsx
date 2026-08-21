import React from "react";
import globalStyle from "@/constants/globalStyle";
import Operations from "./operations";
import Sheets from "./sheets";
// 注意：必须使用 RN 核心 ScrollView，不能用 react-native-gesture-handler 的 ScrollView。
// gesture-handler 的 ScrollView 会通过 NativeViewGestureHandler 拦截子组件的触摸事件，
// 导致“新建歌单 / 导入歌单”等核心 Pressable 按钮点击无效。
import { ScrollView } from "react-native";

export default function HomeBody() {
    return (
        <ScrollView
            style={globalStyle.fwflex1}
            showsVerticalScrollIndicator={false}>
            <Operations />
            <Sheets />
        </ScrollView>
    );
}
