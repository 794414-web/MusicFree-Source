import { addFileScheme } from "@/utils/fileUtils";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { exists, unlink } from "react-native-fs";

// Internal Method
const mediaCacheStore = getOrCreateMMKV("cache.MediaCache", true);

// 最多缓存800条数据
const maxCacheCount = 800;

/** 获取meta信息 */
const getMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const cacheMediaItem = mediaCacheStore.getString(
            getMediaUniqueKey(mediaItem),
        );
        return cacheMediaItem
            ? safeParse<ICommon.IMediaBase>(cacheMediaItem)
            : null;
    }

    return null;
};

/** 设置meta信息 */
const setMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const allKeys = mediaCacheStore.getAllKeys();
        if (allKeys.length >= maxCacheCount) {
            // 删除最旧的一半缓存项，避免长期运行后缓存无限增长
            // MMKV 的 getAllKeys() 不保证顺序，但删除一半足够释放空间
            const removeCount = Math.floor(maxCacheCount / 2);
            for (let i = 0; i < removeCount; ++i) {
                const rawCacheMedia = mediaCacheStore.getString(allKeys[i]);
                const cacheData = rawCacheMedia
                    ? safeParse(rawCacheMedia)
                    : null;
                // 异步清理本地缓存文件，不阻塞当前流程
                clearLocalCaches(cacheData).catch(() => {});

                mediaCacheStore.delete(allKeys[i]);
            }
        }

        mediaCacheStore.set(getMediaUniqueKey(mediaItem), JSON.stringify(mediaItem));
        return true;
    }

    return false;
};

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
        mediaCacheStore.delete(getMediaUniqueKey(mediaItem));
    }

    return false;
};

const MediaCache = {
    getMediaCache,
    setMediaCache,
    removeMediaCache,
};

export default MediaCache;
