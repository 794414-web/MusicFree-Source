import TrackPlayer from "@/core/trackPlayer";
import {
    NezhaThemeModule,
    SteeringWheelModule,
    FullscreenNotificationModule,
    onNezhaThemeChange,
    onSteeringWheelKey,
    onFullscreenStateChange,
    onScreenStateChange,
} from "@/native/nezha";
import Theme from "@/core/theme";
import { useEffect } from "react";
import { useAppConfig } from "@/core/appConfig";
import { musicIsPaused } from "@/utils/trackUtils";
import { setWindowFullscreen, exitWindowFullscreen } from "@/utils/fullscreenHelper";

/**
 * 哪吒车机适配 Hook
 *
 * 集成五个功能：
 * 1. 主题跟随系统 - 读取哪吒系统主题属性，自动切换日间/夜间模式
 * 2. 方向盘媒体按键 - 接收方向盘按键广播，控制播放/暂停/上一首/下一首
 * 3. 多屏检测 - 模块已注册，供悬浮窗模块后续使用
 * 4. 全屏通知控制 - 响应 FULLSCREEN_ON/OFF 广播，控制全屏显示
 * 5. 息屏关闭播放 - 响应 SCREEN_OFF 广播，自动暂停播放
 *
 * 在 BootstrapComponent 中调用，随应用生命周期运行
 *
 * 方向盘控制可通过设置项 basic.steeringWheelControl 开关
 * 息屏关闭播放可通过设置项 basic.screenOffStopPlayback 开关
 * （默认开启，非哪吒车机可在设置中关闭）
 *
 * 实现说明：
 * - 三个功能拆分为独立 useEffect，各自管理监听器生命周期，
 *   避免「方向盘开关变化触发主题监听重启」等跨功能干扰。
 * - 配置项统一使用 useAppConfig 响应式订阅，运行时切换即可生效。
 */
export function useNezhaCarAdapter() {
    // 主题跟随系统（响应式订阅，运行时切换 theme.followSystem 即时生效）
    const followSystem = useAppConfig("theme.followSystem") ?? false;
    // 默认开启（undefined 视为 true），保证哪吒车机用户开箱即用
    const enableSteeringWheel = useAppConfig("basic.steeringWheelControl") ?? true;
    // 默认开启息屏关闭播放
    const enableScreenOffStop = useAppConfig("basic.screenOffStopPlayback") ?? true;

    // ========== 1. 主题跟随系统 ==========
    useEffect(() => {
        if (!followSystem || !NezhaThemeModule.isSupported()) {
            return;
        }
        // 启动主题监听（启动时会立即通知一次当前状态）
        NezhaThemeModule.startListening();

        // 监听主题变化事件
        const unsub = onNezhaThemeChange((event) => {
            if (event.isNight) {
                Theme.setTheme("p-dark");
            } else {
                Theme.setTheme("p-light");
            }
        });

        return () => {
            unsub();
            NezhaThemeModule.stopListening();
        };
    }, [followSystem]);

    // ========== 2. 方向盘媒体按键 ==========
    // 仅当用户在设置中开启且设备支持时启用
    useEffect(() => {
        if (!enableSteeringWheel || !SteeringWheelModule.isSupported()) {
            return;
        }
        SteeringWheelModule.startListening();

        const unsub = onSteeringWheelKey(async (event) => {
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

        return () => {
            unsub();
            SteeringWheelModule.stopListening();
        };
    }, [enableSteeringWheel]);

    // ========== 3. 全屏通知控制 + 屏幕状态监听 ==========
    // 监听车机 FULLSCREEN_ON / FULLSCREEN_OFF 广播
    // 同时监听 SCREEN_OFF / SCREEN_ON 用于息屏关闭播放
    useEffect(() => {
        if (!FullscreenNotificationModule.isSupported()) {
            return;
        }
        FullscreenNotificationModule.startListening();

        // 全屏状态变化
        const unsubFullscreen = onFullscreenStateChange((event) => {
            if (event.state === "on") {
                setWindowFullscreen();
            } else {
                exitWindowFullscreen();
            }
        });

        // 屏幕状态变化（息屏/亮屏）— 受 enableScreenOffStop 控制
        let unsubScreen: (() => void) | null = null;
        if (enableScreenOffStop) {
            unsubScreen = onScreenStateChange(async (event) => {
                if (event.state === "off") {
                    // 息屏时暂停播放
                    try {
                        const RNTrackPlayer = require("react-native-track-player").default;
                        const state = await RNTrackPlayer.getPlaybackState();
                        if (!musicIsPaused(state)) {
                            await TrackPlayer.pause();
                        }
                    } catch {
                        // 播放器未就绪，忽略
                    }
                }
                // 亮屏时不自动恢复播放，需要用户手动操作
            });
        }

        return () => {
            unsubFullscreen();
            if (unsubScreen) {
                unsubScreen();
            }
            FullscreenNotificationModule.stopListening();
        };
    }, [enableScreenOffStop]);
}
