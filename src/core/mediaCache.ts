import { addFileScheme } from "@/utils/fileUtils";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { exists, unlink } from "react-native-fs";

// Internal Method
const mediaCacheStore = getOrCreateMMKV("cache.MediaCache", true);

/**
 * 缓存上限。
 * 默认 800,可通过 Config.setConfig('basic.mediaCacheMaxCount', N) 配置,
 * 低内存设备建议在 bootstrap.setupLowMemoryDefaults 中设更小值(如 400)。
 */
const DEFAULT_MAX_CACHE_COUNT = 800;

/** 内部用的缓存元信息前缀(避免与缓存数据 key 冲突) */
const META_PREFIX = "__meta_ts__";

/**
 * 获取当前生效的缓存上限。
 * 优先读 Config 中的 basic.mediaCacheMaxCount,未设置时用默认值。
 * 直接 require Config 会形成循环依赖,故通过懒加载函数在运行时拿。
 */
function getMaxCacheCount(): number {
    try {
        // 通过 require 避免循环依赖
        const Config = require("@/core/appConfig").default;
        const configured = Config.getConfig("basic.mediaCacheMaxCount");
        return typeof configured === "number" && configured > 0
            ? configured
            : DEFAULT_MAX_CACHE_COUNT;
    } catch {
        return DEFAULT_MAX_CACHE_COUNT;
    }
}

/** 获取meta信息 */
const getMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const cacheMediaItem = mediaCacheStore.getString(
            getMediaUniqueKey(mediaItem),
        );
        // safeParse 内部已兜底 null/损坏 JSON,无需外层再判空
        return safeParse<ICommon.IMediaBase>(cacheMediaItem);
    }

    return null;
};

/**
 * 设置meta信息。
 * 缓存满时按 LRU(最近最少使用)策略删除最旧的一半:
 *  - 每条缓存写入时同步更新 META_PREFIX+key 的时间戳
 *  - 清理时按时间戳升序删除最旧的一半
 *  - 异步清理本地缓存文件,不阻塞当前流程
 */
const setMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const key = getMediaUniqueKey(mediaItem);
        const maxCount = getMaxCacheCount();
        const allKeys = mediaCacheStore.getAllKeys().filter(k => !k.startsWith(META_PREFIX));
        if (allKeys.length >= maxCount) {
            // 删除最旧的一半缓存项,避免长期运行后缓存无限增长
            const removeCount = Math.floor(maxCount / 2);
            // 按 ts 时间戳升序(旧→新)排序后取前 removeCount 个
            const sortedByTs = allKeys
                .map(k => ({ key: k, ts: readTs(k) }))
                .sort((a, b) => a.ts - b.ts);
            for (let i = 0; i < removeCount && i < sortedByTs.length; ++i) {
                const entryKey = sortedByTs[i].key;
                const rawCacheMedia = mediaCacheStore.getString(entryKey);
                const cacheData = safeParse(rawCacheMedia);
                // 异步清理本地缓存文件,不阻塞当前流程。
                // 整条清理用 try/catch 包裹,避免一条畸形数据中断整个清理。
                clearLocalCaches(cacheData).catch(() => {});
                mediaCacheStore.delete(entryKey);
                mediaCacheStore.delete(META_PREFIX + entryKey);
            }
        }

        mediaCacheStore.set(key, JSON.stringify(mediaItem));
        // 更新该 key 的访问时间戳,用于下次 LRU 排序
        writeTs(key);
        return true;
    }

    return false;
};

/** 读取缓存项的访问时间戳,缺失时返回 0(最旧优先清理) */
function readTs(key: string): number {
    const ts = mediaCacheStore.getNumber(META_PREFIX + key);
    return typeof ts === "number" ? ts : 0;
}

/** 写入/刷新当前时间戳到 meta key */
function writeTs(key: string): void {
    mediaCacheStore.set(META_PREFIX + key, Date.now());
}

async function clearLocalCaches(cacheData: IMusic.IMusicItemCache) {
    if (cacheData.$localLyric) {
        await checkPathAndRemove(cacheData.$localLyric.rawLrc);
        await checkPathAndRemove(cacheData.$localLyric.translation);
    }
}

async function checkPathAndRemove(filePath?: string) {
    if (!filePath) {
        return;
    }
    filePath = addFileScheme(filePath);
    if (await exists(filePath)) {
        unlink(filePath);
    }
}

/** 移除缓存信息 */
const removeMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const key = getMediaUniqueKey(mediaItem);
        mediaCacheStore.delete(key);
        mediaCacheStore.delete(META_PREFIX + key);
    }

    return false;
};

const MediaCache = {
    getMediaCache,
    setMediaCache,
    removeMediaCache,
};

export default MediaCache;
