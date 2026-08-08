import TrackPlayer from "@/core/trackPlayer";
import {
    NezhaThemeModule,
    SteeringWheelModule,
    FullscreenNotificationModule,
    onNezhaThemeChange,
    onSteeringWheelKey,
    onFullscreenStateChange,
} from "@/native/nezha";
import Theme from "@/core/theme";
import { useEffect, useRef } from "react";
import Config, { useAppConfig } from "@/core/appConfig";
import { musicIsPaused } from "@/utils/trackUtils";
import { setWindowFullscreen, exitWindowFullscreen } from "@/utils/fullscreenHelper";

/**
 * 哪吒车机适配 Hook
 *
 * 集成四个功能：
 * 1. 主题跟随系统 - 读取哪吒系统主题属性，自动切换日间/夜间模式
 * 2. 方向盘媒体按键 - 接收方向盘按键广播，控制播放/暂停/上一首/下一首
 * 3. 多屏检测 - 模块已注册，供悬浮窗模块后续使用
 * 4. 全屏通知控制 - 响应 FULLSCREEN_ON/OFF 广播，控制全屏显示
 *
 * 在 BootstrapComponent 中调用，随应用生命周期运行
 *
 * 方向盘控制可通过设置项 basic.steeringWheelControl 开关
 * （默认开启，非哪吒车机可在设置中关闭）
 */
export function useNezhaCarAdapter() {
    const unsubThemeRef = useRef<(() => void) | null>(null);
    const unsubSteeringRef = useRef<(() => void) | null>(null);
    const unsubFullscreenRef = useRef<(() => void) | null>(null);
    // 默认开启（undefined 视为 true），保证哪吒车机用户开箱即用
    const enableSteeringWheel = useAppConfig("basic.steeringWheelControl") ?? true;

    useEffect(() => {
        let mounted = true;

        // ========== 1. 主题跟随系统 ==========
        const followSystem = Config.getConfig("theme.followSystem");
        if (followSystem && NezhaThemeModule.isSupported()) {
            // 启动主题监听（启动时会立即通知一次当前状态）
            NezhaThemeModule.startListening();

            // 监听主题变化事件
            unsubThemeRef.current = onNezhaThemeChange((event) => {
                if (!mounted) return;
                if (event.isNight) {
                    Theme.setTheme("p-dark");
                } else {
                    Theme.setTheme("p-light");
                }
            });
        }

        // ========== 2. 方向盘媒体按键 ==========
        // 仅当用户在设置中开启且设备支持时启用
        if (enableSteeringWheel && SteeringWheelModule.isSupported()) {
            SteeringWheelModule.startListening();

            unsubSteeringRef.current = onSteeringWheelKey(async (event) => {
                if (!mounted) return;
                switch (event.action) {
                    case "previous":
                        await TrackPlayer.skipToPrevious();
                        break;
                    case "next":
                        await TrackPlayer.skipToNext();
                        break;
                    case "playPause": {
                        const RNTrackPlayer = require("react-native-track-player").default;
                        try {
                            const state = await RNTrackPlayer.getPlaybackState();
                            if (musicIsPaused(state)) {
                                await TrackPlayer.play();
                            } else {
                                await TrackPlayer.pause();
                            }
                        } catch {
                            // 播放器未就绪，忽略
                        }
                        break;
                    }
                    case "play":
                        await TrackPlayer.play();
                        break;
                    case "pause":
                        await TrackPlayer.pause();
                        break;
                    case "volumeUp":
                    case "volumeDown":
                        // 音量已在原生层处理，JS 层无需重复操作
                        break;
                    default:
                        // 未知按键（如 unknown_10001），忽略
                        break;
                }
            });
        }

        // ========== 3. 全屏通知控制 ==========
        // 监听车机 FULLSCREEN_ON / FULLSCREEN_OFF 广播
        if (FullscreenNotificationModule.isSupported()) {
            FullscreenNotificationModule.startListening();

            unsubFullscreenRef.current = onFullscreenStateChange((event) => {
                if (!mounted) return;
                if (event.state === "on") {
                    setWindowFullscreen();
                } else {
                    exitWindowFullscreen();
                }
            });
        }

        // ========== 清理 ==========
        return () => {
            mounted = false;
            if (unsubThemeRef.current) {
                unsubThemeRef.current();
                unsubThemeRef.current = null;
            }
            if (unsubSteeringRef.current) {
                unsubSteeringRef.current();
                unsubSteeringRef.current = null;
            }
            if (unsubFullscreenRef.current) {
                unsubFullscreenRef.current();
                unsubFullscreenRef.current = null;
            }
            NezhaThemeModule.stopListening();
            if (enableSteeringWheel) {
                SteeringWheelModule.stopListening();
            }
            FullscreenNotificationModule.stopListening();
        };
    }, [enableSteeringWheel]);
}
