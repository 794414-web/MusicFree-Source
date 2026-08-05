import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import useColors from "@/hooks/useColors";
import IconButton from "../base/iconButton";
import TrackPlayer, { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import { musicIsPaused } from "@/utils/trackUtils";
import MusicInfo from "../musicBar/musicInfo";
import Icon from "@/components/base/icon.tsx";
import { showPanel } from "../panels/usePanel";

function MiniPlayer() {
    const musicItem = useCurrentMusic();
    const musicState = useMusicState();
    const colors = useColors();
    const safeAreaInsets = useSafeAreaInsets();
    const isPaused = musicIsPaused(musicState);

    if (!musicItem) {
        return null;
    }

    return (
        <View
            style={[
                styles.wrapper,
                {
                    backgroundColor: colors.musicBar,
                    paddingRight: safeAreaInsets.right + rpx(24),
                },
            ]}
            accessible
            accessibilityLabel={`歌曲: ${musicItem.title} 歌手: ${musicItem.artist}`}>
            <MusicInfo musicItem={musicItem} />
            <View style={styles.actionGroup}>
                <IconButton
                    accessibilityLabel={"播放或暂停歌曲"}
                    name={isPaused ? "play" : "pause"}
                    sizeType={"normal"}
                    color={colors.musicBarText}
                    onPress={async () => {
                        if (isPaused) {
                            await TrackPlayer.play();
                        } else {
                            await TrackPlayer.pause();
                        }
                    }}
                />
                <Icon
                    accessible
                    accessibilityLabel="播放列表"
                    name="playlist"
                    size={rpx(48)}
                    onPress={() => {
                        showPanel("PlayList");
                    }}
                    color={colors.musicBarText}
                    style={[style.actionIcon]}
                />
            </View>
        </View>
    );
}

export default memo(MiniPlayer, () => true);

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: rpx(132),
        flexDirection: "row",
        alignItems: "center",
        paddingRight: rpx(24),
    },
    actionGroup: {
        width: rpx(160),
        justifyContent: "flex-end",
        flexDirection: "row",
        alignItems: "center",
    },
    actionIcon: {
        marginLeft: rpx(24),
    },
});
