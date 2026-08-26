import { musicHistorySheetId } from "@/constants/commonConst";
import { isSameMediaItem } from "@/utils/mediaUtils";
import { getStorage } from "@/utils/storage";
import { atom, getDefaultStore, useAtomValue } from "jotai";

import type { IAppConfig } from "@/types/core/config";
import type { IMusicHistory } from "@/types/core/musicHistory.js";
import type { IInjectable } from "@/types/infra";
import appMeta from "./appMeta";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParseArray, safeStringify } from "@/utils/jsonUtil";


const musicHistoryAtom = atom<IMusic.IMusicItem[]>([]);
const musicHistoryStore = getOrCreateMMKV("music.MusicHistory");

/**
 * 历史记录项的合法性校验:
 * 过滤掉 null/数组/无 id 的脏数据(其他源残留常见)
 */
function isValidHistoryItem(it: any): boolean {
    return (
        it &&
        typeof it === "object" &&
        !Array.isArray(it) &&
        (it as any).id !== undefined &&
        (it as any).id !== null
    );
}

class MusicHistory implements IMusicHistory, IInjectable {
    private configService!: IAppConfig;

    injectDependencies(configService: IAppConfig): void {
        this.configService = configService;
    }

    get history() {
        return getDefaultStore().get(musicHistoryAtom);
    }

    /**
     * 统一的历史记录持久化方法:
     *  - 序列化写入 MMKV
     *  - 同步更新 atom 状态
     * 抽取此方法避免 addMusic/removeMusic/clearMusic/setHistory 各自重复这两行。
     */
    private persistHistory(newHistory: IMusic.IMusicItem[]): void {
        musicHistoryStore.set("history", safeStringify(newHistory));
        getDefaultStore().set(musicHistoryAtom, newHistory);
    }

    async setup() {
        if (appMeta.historySheetVersion < 1) {
            await this.migrateToMMKV();
        }

        // 历史记录可能写入畸形数据(非数组/含 null 项,其他源残留数据常见),
        // safeParseArray 内部统一兜底为空数组并按 isValidHistoryItem 过滤
        const history = safeParseArray<IMusic.IMusicItem>(
            musicHistoryStore.getString("history"),
            isValidHistoryItem,
        );
        getDefaultStore().set(musicHistoryAtom, history);
    }

    async addMusic(musicItem: IMusic.IMusicItem) {
        const newMusicHistory = [
            musicItem,
            ...this.history.filter(item => !isSameMediaItem(item, musicItem)),
        ].slice(0, this.configService.getConfig("basic.maxHistoryLen") ?? 50);
        this.persistHistory(newMusicHistory);
    }

    async removeMusic(musicItem: IMusic.IMusicItem) {
        const newMusicHistory = this.history.filter(
            item => !isSameMediaItem(item, musicItem),
        );
        this.persistHistory(newMusicHistory);
    }

    async clearMusic() {
        this.persistHistory([]);
    }

    async setHistory(newHistory: IMusic.IMusicItem[]) {
        this.persistHistory(newHistory);
    }

    async migrateToMMKV() {
        const history = await getStorage(musicHistorySheetId);
        if (history?.length) {
            musicHistoryStore.set("history", safeStringify(history));
        }
        appMeta.setHistorySheetVersion(1);
    }
}


export function useMusicHistory() {
    return useAtomValue(musicHistoryAtom);
}

const musicHistory = new MusicHistory();
export default musicHistory;

