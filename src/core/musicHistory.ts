import { musicHistorySheetId } from "@/constants/commonConst";
import { isSameMediaItem } from "@/utils/mediaUtils";
import { getStorage } from "@/utils/storage";
import { atom, getDefaultStore, useAtomValue } from "jotai";

import type { IAppConfig } from "@/types/core/config";
import type { IMusicHistory } from "@/types/core/musicHistory.js";
import type { IInjectable } from "@/types/infra";
import appMeta from "./appMeta";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";


const musicHistoryAtom = atom<IMusic.IMusicItem[]>([]);
const musicHistoryStore = getOrCreateMMKV("music.MusicHistory");

class MusicHistory implements IMusicHistory, IInjectable {
    private configService!: IAppConfig;

    injectDependencies(configService: IAppConfig): void {
        this.configService = configService;
    }

    get history() {
        return getDefaultStore().get(musicHistoryAtom);
    }

    async setup() {
        if (appMeta.historySheetVersion < 1) {
            await this.migrateToMMKV();
        }

        const rawHistory = safeParse(musicHistoryStore.getString("history") ?? "[]") as IMusic.IMusicItem[] | null;
        // 历史记录可能写入畸形数据（非数组/含 null 项，其他源残留数据常见），
        // 兜底为空数组并过滤非法项，避免后续 history.filter / 渲染时崩溃
        const history = Array.isArray(rawHistory)
            ? rawHistory.filter(
                  it =>
                      it &&
                      typeof it === "object" &&
                      !Array.isArray(it) &&
                      (it as any).id !== undefined &&
                      (it as any).id !== null,
              )
            : [];
        getDefaultStore().set(musicHistoryAtom, history);
    }

    async addMusic(musicItem: IMusic.IMusicItem) {
        const newMusicHistory = [
            musicItem,
            ...this.history
                .filter(item => !isSameMediaItem(item, musicItem)),
        ].slice(0, this.configService.getConfig("basic.maxHistoryLen") ?? 50);
        
        musicHistoryStore.set("history", safeStringify(newMusicHistory));
        getDefaultStore().set(musicHistoryAtom, newMusicHistory);
    }

    async removeMusic(musicItem: IMusic.IMusicItem) {
        const newMusicHistory = this.history
            .filter(item => !isSameMediaItem(item, musicItem));
        
        musicHistoryStore.set("history", safeStringify(newMusicHistory));
        getDefaultStore().set(musicHistoryAtom, newMusicHistory);
    }

    async clearMusic() {
        musicHistoryStore.set("history", safeStringify([]));
        getDefaultStore().set(musicHistoryAtom, []);
    }

    async setHistory(newHistory: IMusic.IMusicItem[]) {
        musicHistoryStore.set("history", safeStringify(newHistory));
        getDefaultStore().set(musicHistoryAtom, newHistory);
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

