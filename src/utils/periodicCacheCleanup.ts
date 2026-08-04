import { AppState } from "react-native";
import FastImage from "react-native-fast-image";
import getOrCreateMMKV from "./getOrCreateMMKV";
import { trace } from "./log";
import { clearCache } from "./fileUtils";

const MMKV = getOrCreateMMKV("cache.Cleanup");

const CACHE_KEY = "cacheCleanup.lastCleanup";

let appStateSubscription: { remove: () => void } | null = null;
let lastAppState = "active";
let isScheduled = false;

/**
 * 在应用进入后台时执行清理
 * 只清理可以安全重建的缓存，不影响用户体验
 *
 * 改进：原实现只记录时间戳并未真正清理。
 * 现在每隔 6 小时实际执行一次图片磁盘缓存清理，
 * 长时间运行时可以有效回收磁盘与内存。
 */
export function initCacheCleanup() {
    if (appStateSubscription) {
        return;
    }

    appStateSubscription = AppState.addEventListener("change", (nextState) => {
        const prevState = lastAppState;
        lastAppState = nextState;

        if (prevState === "active" && (nextState === "background" || nextState === "inactive")) {
            onAppGoToBackground();
        }

        if (prevState !== "active" && nextState === "active") {
            onAppReturnToForeground();
        }
    });
}

async function onAppGoToBackground() {
    if (isScheduled) {
        return;
    }
    isScheduled = true;

    const lastCleanup = MMKV.getNumber(CACHE_KEY) || 0;
    const now = Date.now();

    // 6 小时内不重复执行
    if (now - lastCleanup < 6 * 60 * 60 * 1000) {
        isScheduled = false;
        return;
    }

    trace("应用进入后台，执行轻量级清理...");

    try {
        MMKV.set(CACHE_KEY, now);

        // 实际执行图片磁盘缓存清理（安全可重建）
        try {
            await FastImage.clearDiskCache();
            trace("图片磁盘缓存已清理");
        } catch (e) {
            trace("清理图片缓存失败:", e);
        }

        // 清理歌词缓存（按需可重建）
        try {
            await clearCache("lyric");
            trace("歌词缓存已清理");
        } catch (e) {
            trace("清理歌词缓存失败:", e);
        }

        trace("后台清理完成");
    } catch (e) {
        trace("后台清理失败:", e);
    } finally {
        isScheduled = false;
    }
}

function onAppReturnToForeground() {
    trace("应用回到前台");
}

export function stopCacheCleanup() {
    if (appStateSubscription) {
        appStateSubscription.remove();
        appStateSubscription = null;
    }
}

export default {
    initCacheCleanup,
    stopCacheCleanup,
};
