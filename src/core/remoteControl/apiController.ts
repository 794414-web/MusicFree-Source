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
     * 统一命令执行路径：包裹返回 IApiResponse 的业务逻辑，仅统一 catch 错误处理。
     *
     * 消除 13 个命令方法中重复的
     *   catch (e: any) { errorLog("XXX失败", e?.message); return this.error(e?.message || "XXX失败"); }
     * 模板。
     *
     * 设计说明：
     * - fn 自行构造 success/error 响应（含动态 message），
     *   本方法只负责捕获 fn 抛出的异常并转为统一错误响应。
     * - 这样既消除了 catch 重复，又完整保留了每个方法各自的成功消息/数据结构。
     * - 参数校验/前置检查（如 ensurePlayerReady、参数范围校验）应放在 fn 之前
     *   以 early return 形式执行，避免被本方法二次包裹。
     */
    private static async executeCommand<T>(
        actionName: string,
        fn: () => Promise<IApiResponse<T>> | IApiResponse<T>,
    ): Promise<IApiResponse<T>> {
        try {
            return await fn();
        } catch (e: any) {
            errorLog(`${actionName}失败`, e?.message);
            return this.error(e?.message || `${actionName}失败`);
        }
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
        const ready = await ApiController.ensurePlayerReady();
        if (!ready) {
            return ApiController.error("播放器尚未初始化");
        }
        return ApiController.executeCommand("获取播放器状态", async () => {
            const RNTrackPlayer = require("react-native-track-player").default;
            const playbackState = await RNTrackPlayer.getPlaybackState();
            const progress = await TrackPlayer.getProgress();
            const volume = await RNTrackPlayer.getVolume().catch(() => 0.5);

            return ApiController.success({
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
        });
    }

    /**
     * 播放音乐
     */
    static async play(musicItem?: IMusic.IMusicItem): Promise<IApiResponse> {
        return ApiController.executeCommand("播放", async () => {
            await TrackPlayer.play(musicItem);
            return ApiController.success(undefined, "播放成功");
        });
    }

    /**
     * 暂停播放
     */
    static async pause(): Promise<IApiResponse> {
        return ApiController.executeCommand("暂停", async () => {
            await TrackPlayer.pause();
            return ApiController.success(undefined, "暂停成功");
        });
    }

    /**
     * 切换播放/暂停
     */
    static async togglePlay(): Promise<IApiResponse> {
        const ready = await ApiController.ensurePlayerReady();
        if (!ready) {
            return ApiController.error("播放器尚未初始化");
        }
        return ApiController.executeCommand("切换播放状态", async () => {
            const playbackState = await require("react-native-track-player").default.getPlaybackState();
            if (playbackState.state === State.Playing) {
                await TrackPlayer.pause();
                return ApiController.success(undefined, "已暂停");
            } else {
                await TrackPlayer.play();
                return ApiController.success(undefined, "已播放");
            }
        });
    }

    /**
     * 下一首
     */
    static async skipToNext(): Promise<IApiResponse> {
        return ApiController.executeCommand("切换下一首", async () => {
            await TrackPlayer.skipToNext();
            return ApiController.success(undefined, "已切换到下一首");
        });
    }

    /**
     * 上一首
     */
    static async skipToPrevious(): Promise<IApiResponse> {
        return ApiController.executeCommand("切换上一首", async () => {
            await TrackPlayer.skipToPrevious();
            return ApiController.success(undefined, "已切换到上一首");
        });
    }

    /**
     * 跳转到指定位置
     */
    static async seekTo(position: number): Promise<IApiResponse> {
        if (typeof position !== "number" || position < 0) {
            return this.error("无效的播放位置");
        }
        return ApiController.executeCommand("跳转", async () => {
            await TrackPlayer.seekTo(position);
            return ApiController.success(undefined, "跳转成功");
        });
    }

    /**
     * 设置播放音量
     */
    static async setVolume(volume: number): Promise<IApiResponse> {
        if (typeof volume !== "number" || volume < 0 || volume > 1) {
            return this.error("音量必须在 0-1 之间");
        }
        return ApiController.executeCommand("设置音量", async () => {
            await require("react-native-track-player").default.setVolume(volume);
            return ApiController.success(undefined, "音量设置成功");
        });
    }

    /**
     * 清空播放列表
     */
    static async clearPlayList(): Promise<IApiResponse> {
        return ApiController.executeCommand("清空播放列表", async () => {
            await TrackPlayer.clearPlayList();
            return ApiController.success(undefined, "播放列表已清空");
        });
    }

    /**
     * 搜索音乐
     */
    static async searchMusic(
        query: string,
        page = 1,
        pluginHash?: string,
    ): Promise<IApiResponse<ISearchResult[]>> {
        if (!query || query.trim() === "") {
            return this.error("搜索关键词不能为空");
        }

        let plugins = pluginHash
            ? [PluginManager.getByHash(pluginHash)].filter(Boolean)
            : PluginManager.getSearchablePlugins();

        if (plugins.length === 0) {
            return this.error("没有可用的搜索插件");
        }

        return ApiController.executeCommand("搜索音乐", async () => {
            const results: ISearchResult[] = [];
            const trimmedQuery = query.trim();

            for (const plugin of plugins) {
                try {
                    const result = await plugin?.methods?.search?.(trimmedQuery, page, "music");
                    if (result?.data?.length) {
                        results.push({
                            query: trimmedQuery,
                            results: result.data as IMusic.IMusicItem[],
                            plugin: plugin?.instance?.platform || plugin?.name || "",
                        });
                    }
                } catch (e: any) {
                    errorLog(`插件 ${plugin?.name} 搜索失败`, e?.message);
                }
            }

            return ApiController.success(
                results,
                results.length > 0 ? "搜索成功" : "未找到结果",
            );
        });
    }

    /**
     * 搜索并播放第一个匹配的音乐
     * 这是最常用的接口：说"播放周杰伦的稻香" → 搜索 → 播放第一个结果
     */
    static async searchAndPlay(
        query: string,
        pluginHash?: string,
    ): Promise<IApiResponse<IMusic.IMusicItem>> {
        if (!query || query.trim() === "") {
            return this.error("搜索关键词不能为空");
        }

        let plugins = pluginHash
            ? [PluginManager.getByHash(pluginHash)].filter(Boolean)
            : PluginManager.getSortedSearchablePlugins();

        if (plugins.length === 0) {
            return this.error("没有可用的搜索插件");
        }

        trace("搜索并播放:", query);

        return ApiController.executeCommand("搜索并播放", async () => {
            const trimmedQuery = query.trim();

            // 逐个插件搜索，找到第一个匹配项就播放
            for (const plugin of plugins) {
                try {
                    const result = await plugin?.methods?.search?.(trimmedQuery, 1, "music");
                    const musicItems = result?.data || [];

                    if (musicItems.length > 0) {
                        const targetMusic = musicItems[0] as IMusic.IMusicItem;
                        trace("找到音乐，准备播放:", `${targetMusic.title} - ${targetMusic.artist}`);
                        await TrackPlayer.play(targetMusic);
                        return ApiController.success(
                            targetMusic,
                            `正在播放: ${targetMusic.title} - ${targetMusic.artist}`,
                        );
                    }
                } catch (e: any) {
                    errorLog(`插件 ${plugin?.name} 搜索失败`, e?.message);
                    continue;
                }
            }

            // 未找到匹配，抛错交由 executeCommand 统一处理
            throw new Error(`未找到与「${query}」匹配的音乐`);
        });
    }

    /**
     * 切换播放模式
     */
    static toggleRepeatMode(): Promise<IApiResponse> {
        return ApiController.executeCommand("切换播放模式", () => {
            TrackPlayer.toggleRepeatMode();
            return ApiController.success(undefined, `播放模式: ${TrackPlayer.repeatMode}`);
        });
    }

    /**
     * 设置播放模式
     * @param mode - "order" | "list" | "single" | "shuffle"
     */
    static setRepeatMode(mode: string): Promise<IApiResponse> {
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
            return Promise.resolve(this.error(`无效的播放模式: ${mode}，支持: order/list/single/shuffle`));
        }
        return ApiController.executeCommand("设置播放模式", () => {
            TrackPlayer.setRepeatMode(targetMode);
            return ApiController.success(undefined, `播放模式已设置为: ${TrackPlayer.repeatMode}`);
        });
    }

    /**
     * 添加音乐到下一首播放
     */
    static addNext(musicItem: IMusic.IMusicItem): Promise<IApiResponse> {
        return ApiController.executeCommand("添加音乐", () => {
            TrackPlayer.addNext(musicItem);
            return ApiController.success(undefined, "已添加到下一首播放");
        });
    }
}

export default ApiController;
