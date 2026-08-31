import React, { useMemo } from "react";
import { Image, StyleSheet, View } from "react-native";
import { ImgAsset } from "@/constants/assetsConst";
import { useCurrentMusic } from "@/core/trackPlayer";
import { useAppConfig } from "@/core/appConfig";
import useColors from "@/hooks/useColors";

type BackgroundMode = "songCover" | "themeColor" | "themeGradient";

export default function Background() {
    const musicItem = useCurrentMusic();
    const colors = useColors();
    const mode = (useAppConfig("basic.musicDetailBackgroundMode") as BackgroundMode) ?? "songCover";

    const artworkSource = useMemo(() => {
        if (!musicItem?.artwork) {
            return ImgAsset.albumDefault;
        }

        if (typeof musicItem.artwork === "string") {
            return {
                uri: musicItem.artwork,
            };
        }
        return musicItem.artwork;
    }, [musicItem?.artwork]);

    const pageBg = colors?.pageBackground ?? colors?.background ?? "#000";
    const primary = colors?.primary ?? "#f17d34";

    if (mode === "themeColor") {
        return <View style={[style.wrapper, { backgroundColor: pageBg }]} />;
    }

    if (mode === "themeGradient") {
        return (
            <>
                <View style={[style.wrapper, { backgroundColor: pageBg }]} />
                {/* 顶部 primary 深色光晕 */}
                <View
                    pointerEvents="none"
                    style={[
                        style.wrapper,
                        {
                            backgroundColor: primary,
                            opacity: 0.35,
                        },
                    ]}
                />
                {/* 顶部圆形径向渐变占位（通过大尺寸 blur 视图模拟） */}
                <View
                    pointerEvents="none"
                    style={[
                        style.topRadial,
                        {
                            backgroundColor: primary,
                            opacity: 0.45,
                        },
                    ]}
                />
                {/* 底部 dark overlay，模拟从亮到暗的过渡 */}
                <View
                    pointerEvents="none"
                    style={[
                        style.bottomFade,
                        {
                            backgroundColor: pageBg,
                            opacity: 0.85,
                        },
                    ]}
                />
            </>
        );
    }

    // 默认：songCover（旧行为）
    return (
        <>
            <View style={style.background} />
            <Image style={style.blur} blurRadius={50} source={artworkSource} />
        </>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    background: {
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#000",
    },
    blur: {
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: 0.5,
    },
    topRadial: {
        position: "absolute",
        top: -320,
        left: -160,
        right: -160,
        height: 720,
        borderRadius: 520,
        transform: [{ scaleX: 1.4 }],
    },
    bottomFade: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "65%",
    },
});
