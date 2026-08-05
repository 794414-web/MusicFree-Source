import React, { memo, useEffect, useState } from "react";
import { StyleSheet, View, TouchableOpacity, Platform } from "react-native";
import rpx from "@/utils/rpx";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TrackPlayer, { useCurrentMusic, useMusicState, useProgress } from "@/core/trackPlayer";
import { musicIsPaused } from "@/utils/trackUtils";
import useColors from "@/hooks/useColors";
import Icon from "@/components/base/icon.tsx";
import ThemeText from "@/components/base/themeText";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { FloatingWindowModule } from "@/native/floatingWindow";
import { showPanel } from "@/components/panels/usePanel";
import FastImage from "@/components/base/fastImage";
import { ImgAsset } from "@/constants/assetsConst";

function MiniPlayer() {
    const musicItem = useCurrentMusic();
    const musicState = useMusicState();
    const progress = useProgress();
    const colors = useColors();
    const safeAreaInsets = useSafeAreaInsets();
    const navigate = useNavigate();

    const [floatingAvailable, setFloatingAvailable] = useState(false);
    const [showFloatingHint, setShowFloatingHint] = useState(false);

    useEffect(() => {
        if (Platform.OS === "android") {
            const supported = FloatingWindowModule.isSupported();
            if (supported) {
                FloatingWindowModule.checkPermission().then(granted => {
                    setFloatingAvailable(granted);
                });
            }
        }
    }, []);

    if (!musicItem) {
        return null;
    }

    const isPaused = musicIsPaused(musicState);

    const handlePlayPause = async () => {
        if (isPaused) {
            await TrackPlayer.play();
        } else {
            await TrackPlayer.pause();
        }
    };

    const handleToggleFloating = async () => {
        if (!floatingAvailable) {
            setShowFloatingHint(true);
            setTimeout(() => setShowFloatingHint(false), 3000);
            return;
        }
        
        const enabled = await FloatingWindowModule.checkPermission();
        if (!enabled) {
            await FloatingWindowModule.requestPermission();
            return;
        }
        await FloatingWindowModule.show(0, 0);
    };

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: colors.musicBar,
                    paddingRight: safeAreaInsets.right + rpx(24),
                    paddingBottom: safeAreaInsets.bottom,
                },
            ]}
        >
            {showFloatingHint && (
                <View style={styles.hintOverlay}>
                    <ThemeText fontSize="small" fontColor="white">
                        请先授予悬浮窗权限
                    </ThemeText>
                </View>
            )}

            <TouchableOpacity
                style={styles.infoContainer}
                onPress={() => navigate(ROUTE_PATH.MUSIC_DETAIL)}
                activeOpacity={0.7}
            >
                <FastImage
                    style={styles.artwork}
                    source={musicItem.artwork}
                    placeholderSource={ImgAsset.albumDefault}
                />
                <View style={styles.textContainer}>
                    <ThemeText
                        fontSize="content"
                        fontColor="musicBarText"
                        numberOfLines={1}
                    >
                        {musicItem.title}
                    </ThemeText>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        numberOfLines={1}
                    >
                        {musicItem.artist}
                    </ThemeText>
                </View>
                <View style={styles.progressBar}>
                    <View
                        style={[
                            styles.progressFill,
                            {
                                width: `${progress?.duration ? (progress.position * 100) / progress.duration : 0}%`,
                                backgroundColor: colors.musicBarText,
                            },
                        ]}
                    />
                </View>
            </TouchableOpacity>

            <View style={styles.controls}>
                <Icon
                    name="skip-previous"
                    size={rpx(44)}
                    color={colors.musicBarText}
                    onPress={() => TrackPlayer.skipToPrevious()}
                />
                <Icon
                    name={isPaused ? "play-circle" : "pause-circle"}
                    size={rpx(64)}
                    color={colors.musicBarText}
                    onPress={handlePlayPause}
                />
                <Icon
                    name="skip-next"
                    size={rpx(44)}
                    color={colors.musicBarText}
                    onPress={() => TrackPlayer.skipToNext()}
                />
            </View>

            <View style={styles.actions}>
                <Icon
                    name="list"
                    size={rpx(40)}
                    color={colors.musicBarText}
                    onPress={() => showPanel("PlayList")}
                />
                {Platform.OS === "android" && (
                    <Icon
                        name="bubble"
                        size={rpx(40)}
                        color={floatingAvailable ? colors.primary : colors.textSecondary}
                        onPress={handleToggleFloating}
                    />
                )}
            </View>
        </View>
    );
}

export default memo(MiniPlayer);

const styles = StyleSheet.create({
    container: {
        width: "100%",
        minHeight: rpx(132),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(16),
    },
    infoContainer: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        height: "100%",
    },
    artwork: {
        width: rpx(80),
        height: rpx(80),
        borderRadius: rpx(8),
        marginRight: rpx(16),
    },
    textContainer: {
        flex: 1,
        justifyContent: "center",
    },
    progressBar: {
        position: "absolute",
        bottom: 0,
        left: rpx(96),
        right: rpx(16),
        height: rpx(3),
        backgroundColor: "rgba(128,128,128,0.3)",
        borderRadius: rpx(2),
    },
    progressFill: {
        height: "100%",
        borderRadius: rpx(2),
    },
    controls: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(8),
        gap: rpx(16),
    },
    actions: {
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(16),
        paddingLeft: rpx(8),
    },
    hintOverlay: {
        position: "absolute",
        top: -rpx(60),
        left: "50%",
        transform: [{ translateX: rpx(-100) }],
        backgroundColor: "rgba(0,0,0,0.8)",
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(8),
        borderRadius: rpx(8),
    },
});
