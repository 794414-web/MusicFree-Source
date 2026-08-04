import TrackPlayer from "@/core/trackPlayer";
import PluginManager from "@/core/pluginManager";
import { trace, errorLog } from "@/utils/log";
import { IApiResponse, IPlayerStatus, ISearchResult } from "./types";
import { State } from "react-native-track-player";
import { MusicRepeatMode } from "@/constants/repeatModeConst";

class ApiController {
    private static success<T>(data?: T, message = "ok"): IApiResponse<T> {
        return { code: 0, message, data };
    }

    private static error(message: string, code = -1): IApiResponse {
        return { code, message };
    }

    /**
     * 检查播放器是否已初始化
     * WS 命令可能在播放器未就绪时到达，直接调用会导致原生层崩溃
     */
    private static async ensurePlayerReady(): Promise<boolean> {
        try {
            const RNTrackPlayer = require("react-native-track-player").default;
            // getPlaybackState 在播放器未初始化时会抛异常
            await RNTrackPlayer.getPlaybackState();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取播放器状态
     */
    static async getPlayerStatus(): Promise<IApiResponse<IPlayerStatus>> {
        try {
            const ready = await ApiController.ensurePlayerReady();
            if (!ready) {
                return ApiController.error("播放器尚未初始化");
            }
            const RNTrackPlayer = require("react-native-track-player").default;
            const playbackState = await RNTrackPlayer.getPlaybackState();
            const progress = await TrackPlayer.getProgress();
            const volume = await RNTrackPlayer.getVolume().catch(() => 0.5);

            return this.success({
                isPlaying: playbackState.state === State.Playing,
                currentMusic: TrackPlayer.currentMusic,
                playList: TrackPlayer.playList,
                progress: {
                    position: progress.position || 0,
                    duration: progress.duration || 0,
                },
                repeatMode: TrackPlayer.repeatMode,
                quality: TrackPlayer.quality,
                volume,
            });
        } catch (e: any) {
            errorLog("获取播放器状态失败", e?.message);
            return this.error(e?.message || "获取播放器状态失败");
        }
    }

    /**
     * 播放音乐
     */
    static async play(musicItem?: IMusic.IMusicItem): Promise<IApiResponse> {
        try {
            await TrackPlayer.play(musicItem);
            return this.success(undefined, "播放成功");
        } catch (e: any) {
            errorLog("播放失败", e?.message);
            return this.error(e?.message || "播放失败");
        }
    }

    /**
     * 暂停播放
     */
    static async pause(): Promise<IApiResponse> {
        try {
            await TrackPlayer.pause();
            return this.success(undefined, "暂停成功");
        } catch (e: any) {
            errorLog("暂停失败", e?.message);
            return this.error(e?.message || "暂停失败");
        }
    }

    /**
     * 切换播放/暂停
     */
    static async togglePlay(): Promise<IApiResponse> {
        try {
            const ready = await ApiController.ensurePlayerReady();
            if (!ready) {
                return ApiController.error("播放器尚未初始化");
            }
            const playbackState = await require("react-native-track-player").default.getPlaybackState();
            if (playbackState.state === State.Playing) {
                await TrackPlayer.pause();
                return this.success(undefined, "已暂停");
            } else {
                await TrackPlayer.play();
                return this.success(undefined, "已播放");
            }
        } catch (e: any) {
            errorLog("切换播放状态失败", e?.message);
            return this.error(e?.message || "切换播放状态失败");
        }
    }

    /**
     * 下一首
     */
    static async skipToNext(): Promise<IApiResponse> {
        try {
            await TrackPlayer.skipToNext();
            return this.success(undefined, "已切换到下一首");
        } catch (e: any) {
            errorLog("切换下一首失败", e?.message);
            return this.error(e?.message || "切换下一首失败");
        }
    }

    /**
     * 上一首
     */
    static async skipToPrevious(): Promise<IApiResponse> {
        try {
            await TrackPlayer.skipToPrevious();
            return this.success(undefined, "已切换到上一首");
        } catch (e: any) {
            errorLog("切换上一首失败", e?.message);
            return this.error(e?.message || "切换上一首失败");
        }
    }

    /**
     * 跳转到指定位置
     */
    static async seekTo(position: number): Promise<IApiResponse> {
        try {
            if (typeof position !== "number" || position < 0) {
                return this.error("无效的播放位置");
            }
            await TrackPlayer.seekTo(position);
            return this.success(undefined, "跳转成功");
        } catch (e: any) {
            errorLog("跳转失败", e?.message);
            return this.error(e?.message || "跳转失败");
        }
    }

    /**
     * 设置播放音量
     */
    static async setVolume(volume: number): Promise<IApiResponse> {
        try {
            if (typeof volume !== "number" || volume < 0 || volume > 1) {
                return this.error("音量必须在 0-1 之间");
            }
            await require("react-native-track-player").default.setVolume(volume);
            return this.success(undefined, "音量设置成功");
        } catch (e: any) {
            errorLog("设置音量失败", e?.message);
            return this.error(e?.message || "设置音量失败");
        }
    }

    /**
     * 清空播放列表
     */
    static async clearPlayList(): Promise<IApiResponse> {
        try {
            await TrackPlayer.clearPlayList();
            return this.success(undefined, "播放列表已清空");
        } catch (e: any) {
            errorLog("清空播放列表失败", e?.message);
            return this.error(e?.message || "清空播放列表失败");
        }
    }

    /**
     * 搜索音乐
     */
    static async searchMusic(
        query: string,
        page = 1,
        pluginHash?: string,
    ): Promise<IApiResponse<ISearchResult[]>> {
        try {
            if (!query || query.trim() === "") {
                return this.error("搜索关键词不能为空");
            }

            let plugins = pluginHash
                ? [PluginManager.getByHash(pluginHash)].filter(Boolean)
                : PluginManager.getSearchablePlugins();

            if (plugins.length === 0) {
                return this.error("没有可用的搜索插件");
            }

            const results: ISearchResult[] = [];

            for (const plugin of plugins) {
                try {
                    const result = await plugin?.methods?.search?.(query.trim(), page, "music");
                    if (result?.data?.length) {
                        results.push({
                            query: query.trim(),
                            results: result.data,
                            plugin: plugin.instance?.platform || plugin.name,
                        });
                    }
                } catch (e: any) {
                    errorLog(`插件 ${plugin.name} 搜索失败`, e?.message);
                }
            }

            return this.success(results, results.length > 0 ? "搜索成功" : "未找到结果");
        } catch (e: any) {
            errorLog("搜索音乐失败", e?.message);
            return this.error(e?.message || "搜索音乐失败");
        }
    }

    /**
     * 搜索并播放第一个匹配的音乐
     * 这是最常用的接口：说"播放周杰伦的稻香" → 搜索 → 播放第一个结果
     */
    static async searchAndPlay(
        query: string,
        pluginHash?: string,
    ): Promise<IApiResponse<IMusic.IMusicItem>> {
        try {
            if (!query || query.trim() === "") {
                return this.error("搜索关键词不能为空");
            }

            trace("搜索并播放:", query);

            let plugins = pluginHash
                ? [PluginManager.getByHash(pluginHash)].filter(Boolean)
                : PluginManager.getSortedSearchablePlugins();

            if (plugins.length === 0) {
                return this.error("没有可用的搜索插件");
            }

            // 逐个插件搜索，找到第一个匹配项就播放
            for (const plugin of plugins) {
                try {
                    const result = await plugin?.methods?.search?.(query.trim(), 1, "music");
                    const musicItems = result?.data || [];

                    if (musicItems.length > 0) {
                        const targetMusic = musicItems[0];
                        trace("找到音乐，准备播放:", targetMusic.title, targetMusic.artist);
                        await TrackPlayer.play(targetMusic);
                        return this.success(targetMusic, `正在播放: ${targetMusic.title} - ${targetMusic.artist}`);
                    }
                } catch (e: any) {
                    errorLog(`插件 ${plugin.name} 搜索失败`, e?.message);
                    continue;
                }
            }

            return this.error(`未找到与「${query}」匹配的音乐`);
        } catch (e: any) {
            errorLog("搜索并播放失败", e?.message);
            return this.error(e?.message || "搜索并播放失败");
        }
    }

    /**
     * 切换播放模式
     */
    static toggleRepeatMode(): IApiResponse {
        try {
            TrackPlayer.toggleRepeatMode();
            return this.success(undefined, `播放模式: ${TrackPlayer.repeatMode}`);
        } catch (e: any) {
            errorLog("切换播放模式失败", e?.message);
            return this.error(e?.message || "切换播放模式失败");
        }
    }

    /**
     * 设置播放模式
     * @param mode - "order" | "list" | "single" | "shuffle"
     */
    static setRepeatMode(mode: string): IApiResponse {
        try {
            const modeMap: Record<string, MusicRepeatMode> = {
                order: MusicRepeatMode.QUEUE,
                list: MusicRepeatMode.QUEUE,
                queue: MusicRepeatMode.QUEUE,
                single: MusicRepeatMode.SINGLE,
                shuffle: MusicRepeatMode.SHUFFLE,
                random: MusicRepeatMode.SHUFFLE,
            };
            const targetMode = modeMap[mode?.toLowerCase()];
            if (!targetMode) {
                return this.error(`无效的播放模式: ${mode}，支持: order/list/single/shuffle`);
            }
            TrackPlayer.setRepeatMode(targetMode);
            return this.success(undefined, `播放模式已设置为: ${TrackPlayer.repeatMode}`);
        } catch (e: any) {
            errorLog("设置播放模式失败", e?.message);
            return this.error(e?.message || "设置播放模式失败");
        }
    }

    /**
     * 添加音乐到下一首播放
     */
    static addNext(musicItem: IMusic.IMusicItem): IApiResponse {
        try {
            TrackPlayer.addNext(musicItem);
            return this.success(undefined, "已添加到下一首播放");
        } catch (e: any) {
            errorLog("添加音乐失败", e?.message);
            return this.error(e?.message || "添加音乐失败");
        }
    }
}

export default ApiController;
