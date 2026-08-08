import { NativeModule, NativeModules, Platform } from 'react-native';
import getOrCreateMMKV from '@/utils/getOrCreateMMKV';

/**
 * NetA 哪吒互联 - 元数据 API TypeScript 桥接
 *
 * 通过 Android AF_UNIX Socket 与哪吒互联服务通信
 * 提供歌词和封面数据查询能力
 */

interface INetAMetadataModule extends NativeModule {
    /** 健康检查 */
    healthCheck: () => Promise<{ status: string; protocolVersion: number }>;
    /** 获取歌词 */
    getLyric: (title: string, artist: string) => Promise<NetALyricResponse>;
    /** 获取封面 URL */
    getCover: (title: string, artist: string) => Promise<NetACoverResponse>;
    /** 批量获取歌词 */
    batchGetLyric: (requests: Record<string, { title: string; artist: string }>) => Promise<Array<{ key: string; lyric: NetALyricResponse | null }>>;
}

/** 歌词响应 */
export interface NetALyricResponse {
    requestId: number;
    title: string;
    artist: string;
    /** LRC 格式行数组 */
    lines: Array<{ timeMs: number; text: string }>;
    /** 生成的 LRC 格式文本 */
    rawLrc: string;
    error?: string;
}

/** 封面响应 */
export interface NetACoverResponse {
    requestId: number;
    title: string;
    artist: string;
    /** 封面图片 URL */
    coverUrl: string;
    error?: string;
}

const NetAMetadataNative: INetAMetadataModule | undefined = NativeModules.NetAMetadata;

function isNetASupported(): boolean {
    return Platform.OS === 'android' && !!NetAMetadataNative;
}

// 封面 URL 缓存，避免重复请求
const coverCacheStore = getOrCreateMMKV('NetA.CoverCache');

// 内存缓存
const coverCache = new Map<string, { url: string | null; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时

function getCacheKey(title: string, artist: string): string {
    return `${title}@${artist}`;
}

function getCachedCover(title: string, artist: string): string | null | undefined {
    const key = getCacheKey(title, artist);
    
    // 先查内存缓存
    const memCached = coverCache.get(key);
    if (memCached && Date.now() - memCached.ts < CACHE_TTL_MS) {
        return memCached.url;
    }
    
    // 再查 MMKV 缓存
    const persisted = coverCacheStore.getString(key);
    if (persisted) {
        try {
            const parsed = JSON.parse(persisted);
            if (Date.now() - parsed.ts < CACHE_TTL_MS) {
                coverCache.set(key, { url: parsed.url, ts: parsed.ts });
                return parsed.url;
            }
        } catch {}
    }
    
    return undefined;
}

function setCachedCover(title: string, artist: string, url: string | null) {
    const key = getCacheKey(title, artist);
    const ts = Date.now();
    coverCache.set(key, { url, ts });
    coverCacheStore.set(key, JSON.stringify({ url, ts }));
}

export const NetAMetadata = {
    /** 是否支持 NetA 元数据服务 */
    isSupported: isNetASupported,

    /**
     * 检查 NetA 服务是否可用
     */
    async healthCheck(): Promise<boolean> {
        if (!NetAMetadataNative) {
            return false;
        }
        try {
            const result = await NetAMetadataNative.healthCheck();
            return result?.status === 'ok';
        } catch {
            return false;
        }
    },

    /**
     * 获取歌词
     * @param title 歌曲标题
     * @param artist 歌手
     * @returns 歌词数据，失败返回 null
     */
    async getLyric(title: string, artist: string): Promise<NetALyricResponse | null> {
        if (!NetAMetadataNative || !title) {
            return null;
        }
        try {
            const result = await NetAMetadataNative.getLyric(title, artist);
            if (result && !result.error) {
                return result;
            }
            return null;
        } catch {
            return null;
        }
    },

    /**
     * 获取封面 URL（带缓存）
     * @param title 歌曲标题
     * @param artist 歌手
     * @returns 封面 URL，失败返回 null
     */
    async getCover(title: string, artist: string): Promise<string | null> {
        if (!NetAMetadataNative || !title) {
            return null;
        }

        // 检查缓存
        const cached = getCachedCover(title, artist);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const result = await NetAMetadataNative.getCover(title, artist);
            const url = (result && !result.error && result.coverUrl) ? result.coverUrl : null;
            setCachedCover(title, artist, url);
            return url;
        } catch {
            setCachedCover(title, artist, null);
            return null;
        }
    },

    /**
     * 解析封面 URL：如果 musicItem 没有 artwork，尝试从 NetA 获取
     * @param musicItem 音乐项
     * @returns 封面 URL（可能是原 artwork 或 NetA 返回的 URL）
     */
    async resolveArtwork(musicItem: IMusic.IMusicItem): Promise<string | null> {
        if (!musicItem) {
            return null;
        }

        // 如果已有有效 artwork，直接返回
        if (musicItem.artwork && musicItem.artwork.trim().length > 0) {
            return musicItem.artwork;
        }

        // 否则从 NetA 获取
        const title = musicItem.alias || musicItem.title;
        const artist = musicItem.artist || '';
        return this.getCover(title, artist);
    },

    /**
     * 将 NetA 歌词响应转换为 ILyric.ILyricSource 格式
     * @param response NetA 歌词响应
     */
    toLyricSource(response: NetALyricResponse): ILyric.ILyricSource {
        return {
            rawLrc: response.rawLrc,
        };
    },

    /**
     * 清除封面缓存
     */
    clearCoverCache(): void {
        coverCache.clear();
        coverCacheStore.clearAll();
    },
};

export default NetAMetadata;