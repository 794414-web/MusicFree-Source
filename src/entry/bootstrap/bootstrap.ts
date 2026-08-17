import "react-native-get-random-values";

import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog.ts";
import cacheCleanup from "@/utils/periodicCacheCleanup";
import { startMemoryMonitor, updateCleanupConfig, getCleanupConfig } from "@/utils/memoryMonitor";
import { ImgAsset } from "@/constants/assetsConst";
import { emptyFunction, localPluginHash, supportLocalMediaType } from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import Config from "@/core/appConfig";
import downloader, { DownloadFailReason, DownloaderEvent } from "@/core/downloader";
import LocalMusicSheet from "@/core/localMusicSheet";
import lyricManager from "@/core/lyricManager";
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import PluginManager from "@/core/pluginManager";
import Theme from "@/core/theme";
import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { checkAndCreateDir } from "@/utils/fileUtils";
import { crashLog, setupGlobalErrorHandler, trace } from "@/utils/log";
import { IPerfLogger, perfLogger } from "@/utils/perfLogger";
import PersistStatus from "@/utils/persistStatus";
import Toast from "@/utils/toast";
import * as SplashScreen from "expo-splash-screen";
import {  Linking, Platform } from "react-native";
import { PERMISSIONS, check, request } from "react-native-permissions";
import RNFS, { readDir, unlink } from "react-native-fs";
import RNTrackPlayer, { AppKilledPlaybackBehavior, Capability } from "react-native-track-player";
import i18n from "@/core/i18n";
import bootstrapAtom from "./bootstrap.atom";
import { getDefaultStore } from "jotai";
import RemoteControlService from "@/core/remoteControl";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";

/**
 * 内置音源清单
 * 这些 js 文件位于 android/app/src/main/assets/plugins/
 * 首次启动或版本升级时自动复制到插件目录
 */
const BUILTIN_PLUGINS_VERSION = "3";
const BUILTIN_PLUGIN_FILES: string[] = [];


// 依赖管理
PluginManager.injectDependencies(Config);
musicHistory.injectDependencies(Config);
TrackPlayer.injectDependencies(Config, musicHistory, PluginManager);
downloader.injectDependencies(Config, PluginManager);
lyricManager.injectDependencies(TrackPlayer, Config, PluginManager);
MusicSheet.injectDependencies(Config);

/**
 * 设置低内存占用默认配置
 * 仅对尚未设置的配置项设置默认值，不覆盖用户已有设置
 */
function setupLowMemoryDefaults() {
    const defaults: Array<[string, any]> = [
        ["basic.lazyLoadPlugin", true],
        ["basic.maxCacheSize", 100 * 1024 * 1024],
        ["basic.autoUpdatePlugin", false],
        ["basic.maxHistoryLen", 20],
        ["basic.musicDetailAwake", false],
        ["basic.autoPlayWhenAppStart", false],
        ["basic.notInterrupt", true],
        ["basic.tryChangeSourceWhenPlayFail", true],
        ["basic.autoStopWhenError", false],
        ["basic.showExitOnNotification", false],
        ["basic.defaultPlayQuality", "standard"],
        ["basic.playQualityOrder", "desc"],
        ["basic.defaultDownloadQuality", "standard"],
        ["basic.downloadQualityOrder", "desc"],
        ["basic.maxDownload", 1],
        ["debug.errorLog", true],
        ["debug.traceLog", false],
        ["debug.devLog", false],
        ["lyric.showStatusBarLyric", false],
        ["lyric.autoSearchLyric", false],
        ["basic.floatingWindow", false],
        ["basic.steeringWheelControl", false],
        ["basic.disableNotification", true],
        ["basic.screenOffStopPlayback", true],
        ["basic.associateLyricType", "input"],
        ["basic.autoMemoryCleanup", true],
        ["basic.memoryCleanupThreshold", 300],
        ["basic.memoryCleanupInterval", 15],
    ];

    defaults.forEach(([key, value]) => {
        if (Config.getConfig(key as any) === undefined) {
            Config.setConfig(key as any, value);
        }
    });

    console.log("已应用低内存默认配置");
}

/**
 * 初始化内存自动清理配置
 */
function initMemoryCleanupConfig() {
    const enabled = Config.getConfig("basic.autoMemoryCleanup");
    const threshold = Config.getConfig("basic.memoryCleanupThreshold");
    const interval = Config.getConfig("basic.memoryCleanupInterval");

    if (enabled !== undefined || threshold !== undefined || interval !== undefined) {
        updateCleanupConfig({
            enabled: enabled ?? true,
            thresholdMB: threshold ?? 400,
            intervalMin: interval ?? 30,
        });
    }
}


async function bootstrapImpl() {
    // 尽早注册全局错误处理器（在一切初始化之前），
    // 确保启动阶段的任何未捕获异常/致命错误都能写入崩溃日志，便于定位闪退
    setupGlobalErrorHandler();

    await SplashScreen.preventAutoHideAsync()
        .then(result =>
            console.log(
                `SplashScreen.preventAutoHideAsync() succeeded: ${result}`,
            ),
        )
        .catch(console.warn); // it's good to explicitly catch and inspect any error
    const logger = perfLogger();
    // 1. 检查权限
    if (Platform.OS === "android" && Platform.Version >= 30) {
        const hasPermission = await NativeUtils.checkStoragePermission();
        if (
            !hasPermission &&
            !PersistStatus.get("app.skipBootstrapStorageDialog")
        ) {
            showDialog("CheckStorage");
        }
    } else {
        const [readStoragePermission, writeStoragePermission] =
            await Promise.all([
                check(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE),
                check(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE),
            ]);
        if (
            !(
                readStoragePermission === "granted" &&
                writeStoragePermission === "granted"
            )
        ) {
            await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
            await request(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE);
        }
    }
    logger.mark("权限检查完成");

    // 2. 数据初始化
    /** 初始化路径 */
    await setupFolder();
    trace("文件夹初始化完成");
    logger.mark("文件夹初始化完成");



    // 加载配置
    await Promise.all([
        Config.setup().then(() => {
            logger.mark("Config");
        }),
        MusicSheet.setup().then(() => {
            logger.mark("MusicSheet");
        }),
        musicHistory.setup().then(() => {
            logger.mark("musicHistory");
        }),
    ]);
    trace("配置初始化完成");
    logger.mark("配置初始化完成");

    // 设置低内存占用默认配置
    setupLowMemoryDefaults();

    // 初始化内存自动清理配置
    initMemoryCleanupConfig();

    // 安装内置音源（在插件加载之前）
    try {
        await setupBuiltinPlugins();
    } catch (e) {
        console.error("安装内置音源失败:", e);
    }

    // 加载插件
    await PluginManager.setup();
    logger.mark("插件初始化完成");
    trace("插件初始化完成");

    // 设置默认插件订阅（车载版专用）
    try {
        await setupDefaultPluginSubscribe();
    } catch (e) {
        console.error("设置默认插件订阅失败:", e);
    }

    // 启动定期缓存清理
    try {
        cacheCleanup.initCacheCleanup();
    } catch (e) {
        console.error("启动缓存清理失败:", e);
    }

    // 启动内存监控（每 2 分钟采样一次，更快发现内存问题）
    try {
        startMemoryMonitor(2 * 60 * 1000);
    } catch (e) {
        console.error("启动内存监控失败:", e);
    }

    await initTrackPlayer(logger).catch(err => {
        // 初始化播放器出错，延迟初始化
        const bootstrapState = getDefaultStore().get(bootstrapAtom);

        if (bootstrapState.state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                state: "TrackPlayerError",
                reason: err,
            });
        }
    });

    await LocalMusicSheet.setup();
    trace("本地音乐初始化完成");
    logger.mark("本地音乐初始化完成");

    Theme.setup();
    trace("主题初始化完成");
    logger.mark("主题初始化完成");

    extraMakeup();

    i18n.setup();
    logger.mark("语言模块初始化完成");
}

/** 初始化 */
async function setupFolder() {
    await Promise.all([
        checkAndCreateDir(pathConst.dataPath),
        checkAndCreateDir(pathConst.logPath),
        checkAndCreateDir(pathConst.cachePath),
        checkAndCreateDir(pathConst.pluginPath),
        checkAndCreateDir(pathConst.lrcCachePath),
        checkAndCreateDir(pathConst.downloadCachePath),
        checkAndCreateDir(pathConst.localLrcPath),
        checkAndCreateDir(pathConst.downloadPath).then(() => {
            checkAndCreateDir(pathConst.downloadMusicPath);
        }),
    ]);
}

export async function initTrackPlayer(logger?: IPerfLogger) {
    // 禁用通知栏：关闭自动更新通知元数据（避免切歌/播放时向通知栏推送），
    // 不再调用 clearNowPlayingMetadata（在空播放队列时原生层会空指针崩溃）
    const disableNotification =
        Config.getConfig("basic.disableNotification") ?? true;
    try {
        await RNTrackPlayer.setupPlayer({
            maxCacheSize:
                Config.getConfig("basic.maxCacheSize") ?? 100 * 1024 * 1024,
            minBuffer: 30,
            maxBuffer: 60,
            bufferInterval: 250,
            progressUpdateEventInterval: 2,
            autoUpdateMetadata: !disableNotification,
        });
    } catch (e: any) {
        if (
            e?.message !==
            "The player has already been initialized via setupPlayer."
        ) {
            throw e;
        }
    }
    logger?.mark("加载播放器");

    const capabilities = Config.getConfig("basic.showExitOnNotification")
        ? [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.Stop,
        ]
        : [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
        ];
    await RNTrackPlayer.updateOptions({
        icon: ImgAsset.logoTransparent,
        progressUpdateEventInterval: 1,
        android: {
            alwaysPauseOnInterruption: true,
            appKilledPlaybackBehavior:
                AppKilledPlaybackBehavior.ContinuePlayback,
        },
        capabilities: capabilities,
        compactCapabilities: capabilities,
        notificationCapabilities: [...capabilities, Capability.SeekTo],
    });

    logger?.mark("播放器初始化完成");
    trace("播放器初始化完成");

    await TrackPlayer.setupTrackPlayer();
    trace("播放列表初始化完成");
    logger?.mark("播放列表初始化完成");

    await lyricManager.setup();

    logger?.mark("歌词初始化完成");
}


/** 不需要阻塞的 */
async function extraMakeup() {
    // 自动更新
    try {
        if (Config.getConfig("basic.autoUpdatePlugin")) {
            const lastUpdated = PersistStatus.get("app.pluginUpdateTime") || 0;
            const now = Date.now();
            if (Math.abs(now - lastUpdated) > 86400000) {
                PersistStatus.set("app.pluginUpdateTime", now);
                const plugins = PluginManager.getEnabledPlugins();
                for (let i = 0; i < plugins.length; ++i) {
                    const srcUrl = plugins[i].instance.srcUrl;
                    if (srcUrl) {
                        // 静默失败
                        await PluginManager.installPluginFromUrl(srcUrl).catch(emptyFunction);
                    }
                }
            }
        }
    } catch { }

    async function handleLinkingUrl(url: string) {
        // 插件
        try {
            if (url.startsWith("musicfree://install/")) {
                const plugins = url
                    .slice(20)
                    .split(",")
                    .map(decodeURIComponent);
                await Promise.all(
                    plugins.map(it =>
                        PluginManager.installPluginFromUrl(it).catch(emptyFunction),
                    ),
                );
                Toast.success("安装成功~");
            } else if (url.endsWith(".js")) {
                PluginManager.installPluginFromLocalFile(url, {
                    notCheckVersion: Config.getConfig(
                        "basic.notCheckPluginVersion",
                    ),
                })
                    .then(res => {
                        if (res.success) {
                            Toast.success(`插件「${res.pluginName}」安装成功~`);
                        } else {
                            Toast.warn("安装失败: " + res.message);
                        }
                    })
                    .catch(e => {
                        console.log(e);
                        Toast.warn(e?.message ?? "无法识别此插件");
                    });
            } else if (supportLocalMediaType.some(it => url.endsWith(it))) {
                // 本地播放
                const musicItem = await PluginManager.getByHash(
                    localPluginHash,
                )?.instance?.importMusicItem?.(url);
                console.log(musicItem);
                if (musicItem) {
                    TrackPlayer.play(musicItem);
                }
            }
        } catch { }
    }

    // 开启监听
    Linking.addEventListener("url", data => {
        if (data.url) {
            handleLinkingUrl(data.url);
        }
    });
    const initUrl = await Linking.getInitialURL();
    if (initUrl) {
        handleLinkingUrl(initUrl);
    }

    if (Config.getConfig("basic.autoPlayWhenAppStart")) {
        TrackPlayer.play();
    }

    // 启动远程控制服务（车载AI控制）
    // 延迟 2 秒启动，确保 TrackPlayer 完全初始化后再接受 WS 命令
    try {
        const remoteConfig = RemoteControlService.loadConfig();
        if (remoteConfig.enabled && remoteConfig.wsUrl) {
            setTimeout(() => {
                RemoteControlService.start().catch(e => {
                    console.error("启动远程控制服务失败:", e);
                });
            }, 2000);
        }
    } catch (e) {
        console.error("启动远程控制服务失败:", e);
    }
}


function bindEvents() {
    // 下载事件
    downloader.on(DownloaderEvent.DownloadError, (reason) => {
        if (reason === DownloadFailReason.NetworkOffline) {
            Toast.warn("当前无网络连接，请等待网络恢复后重试");
        } else if (reason === DownloadFailReason.NotAllowToDownloadInCellular) {
            if (getCurrentDialog()?.name !== "SimpleDialog") {
                showDialog("SimpleDialog", {
                    title: "流量提醒",
                    content: "当前非WIFI环境，为节省流量，请到侧边栏设置中打开【使用移动网络下载】功能后方可继续下载",
                });
            }
        }
    });

    downloader.on(DownloaderEvent.DownloadQueueCompleted, () => {
        Toast.success("下载任务已完成");
    });
}

/**
 * 安装内置音源
 * 将 assets/plugins/ 下的音源 js 文件复制到插件目录
 * 仅在内置音源版本更新时执行，避免重复复制
 */
async function setupBuiltinPlugins() {
    const installedVersion = Config.getConfig("basic.builtinPluginsVersion");
    if (installedVersion === BUILTIN_PLUGINS_VERSION) {
        return;
    }

    await checkAndCreateDir(pathConst.pluginPath);

    for (const fileName of BUILTIN_PLUGIN_FILES) {
        const destPath = `${pathConst.pluginPath}${fileName}`;
        const assetPath = `plugins/${fileName}`;
        try {
            const assetExists = await RNFS.existsAssets(assetPath);
            if (!assetExists) {
                console.warn(`内置音源不存在: ${assetPath}`);
                continue;
            }
            await RNFS.copyFileAssets(assetPath, destPath);
            console.log(`已安装内置音源: ${fileName}`);
        } catch (e) {
            console.error(`复制内置音源失败 ${fileName}:`, e);
        }
    }

    Config.setConfig("basic.builtinPluginsVersion", BUILTIN_PLUGINS_VERSION);
    console.log("内置音源安装完成");
}

/**
 * 设置默认插件订阅（车载版专用）
 * 首次启动时自动添加订阅源并安装插件
 */
async function setupDefaultPluginSubscribe() {
    try {
        const currentSubscribe = Config.getConfig("plugin.subscribeUrl");
        const OLD_DEFAULT_URL = "https://13413.kstore.vip/yuanli/yuanli.json";
        const NEW_DEFAULT_URL = "https://www.imwzh.com/musicfree.json";

        // 如果还没有订阅，或是旧的默认订阅，则更新为新的
        if (
            !currentSubscribe ||
            currentSubscribe.trim() === "" ||
            currentSubscribe.includes(OLD_DEFAULT_URL)
        ) {
            const defaultSubscribe = JSON.stringify([
                {
                    name: "MusicFree 音源库",
                    url: NEW_DEFAULT_URL,
                },
            ]);
            Config.setConfig("plugin.subscribeUrl", defaultSubscribe);
            console.log("已设置默认插件订阅：MusicFree 音源库");
            
            // 清除旧插件缓存（内置音源已移除）
            try {
                const pluginCacheStore = getOrCreateMMKV("plugin.cache");
                const cachedKeys = pluginCacheStore.getAllKeys();
                cachedKeys.forEach(key => {
                    pluginCacheStore.delete(key);
                });
                console.log("已清除旧插件缓存");
            } catch {}
            
            // 清除旧插件文件
            try {
                const pluginFiles = await readDir(pathConst.pluginPath);
                const builtinFilePatterns = [
                    "xiaoqiu", "xiaowo", "xiaoyun", "xiaogou",
                    "xiaomi", "sixyin", "qishui"
                ];
                for (const file of pluginFiles) {
                    const name = file.name ?? file.path ?? "";
                    if (builtinFilePatterns.some(p => name.startsWith(p))) {
                        try {
                            await unlink(file.path);
                        } catch {}
                    }
                }
                console.log("已清除旧内置音源文件");
            } catch {}

            // 延迟一下，等订阅设置完成后再安装插件
            setTimeout(async () => {
                try {
                    console.log("开始自动安装订阅插件...");
                    // 从订阅 URL 安装插件
                    const urlItems = JSON.parse(defaultSubscribe);
                    if (Array.isArray(urlItems)) {
                        for (let i = 0; i < urlItems.length; ++i) {
                            await PluginManager.installPluginFromUrl(urlItems[i].url);
                        }
                        console.log("自动安装订阅插件完成");
                    }
                } catch (e) {
                    console.error("自动安装订阅插件失败:", e);
                }
            }, 3000);
        }
    } catch (e) {
        console.error("设置默认插件订阅失败:", e);
    }
}

export default async function () {
    try {
        getDefaultStore().set(bootstrapAtom, {
            "state": "Loading",
        });
        await bootstrapImpl();
        bindEvents();
        getDefaultStore().set(bootstrapAtom, {
            "state": "Done",
        });
    } catch (e: any) {
        crashLog("初始化出错", {
            message: e?.message ?? String(e),
            stack: e?.stack,
        });
        if (getDefaultStore().get(bootstrapAtom).state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                state: "Fatal",
                reason: e,
            });
        }
    }
    // 隐藏开屏动画
    console.log("HIDE");
    await SplashScreen.hideAsync();
}