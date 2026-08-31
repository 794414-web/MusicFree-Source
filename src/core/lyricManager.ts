import { IAppConfig } from "@/types/core/config";
import { ITrackPlayer } from "@/types/core/trackPlayer";
import { IInjectable } from "@/types/infra";
import LyricParser, { IParsedLrcItem } from "@/utils/lrcParser";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import { isSameMediaItem } from "@/utils/mediaUtils";
import minDistance from "@/utils/minDistance";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { Plugin } from "./pluginManager";

import pathConst from "@/constants/pathConst";
import LyricUtil from "@/native/lyricUtil";
import { checkAndCreateDir } from "@/utils/fileUtils";
import PersistStatus from "@/utils/persistStatus";
import CryptoJs from "crypto-js";
import { unlink, writeFile } from "react-native-fs";
import RNTrackPlayer, { Event } from "react-native-track-player";
import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import { IPluginManager } from "@/types/core/pluginManager";
import NetAMetadata from "@/native/neta";


interface ILyricState {
    loading: boolean;
    lyrics: IParsedLrcItem[];
    hasTranslation: boolean;
    meta?: Record<string, string>;
}

const defaultLyricState = {
    loading: true,
    lyrics: [],
    hasTranslation: false,
};

const lyricStateAtom = atom<ILyricState>(defaultLyricState);
const currentLyricItemAtom = atom<IParsedLrcItem | null>(null);


class LyricManager implements IInjectable {

    private trackPlayer!: ITrackPlayer;
    private appConfig!: IAppConfig;
    private pluginManager!: IPluginManager;

    private lyricParser: LyricParser | null = null;


    get currentLyricItem() {
        return getDefaultStore().get(currentLyricItemAtom);
    }

    get lyricState() {
        return getDefaultStore().get(lyricStateAtom);
    }

    injectDependencies(trackPlayerService: ITrackPlayer, appConfigService: IAppConfig, pluginManager: IPluginManager): void {
        this.trackPlayer = trackPlayerService;
        this.appConfig = appConfigService;
        this.pluginManager = pluginManager;
    }

    // 进度监听句柄，避免重复注册
    private progressSubscription: { remove: () => void } | null = null;
    // 节流时间戳，限制 atom 更新频率到约 500ms 一次
    private lastProgressUpdateTs = 0;

    setup() {
        // 更新歌词
        this.trackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, (musicItem) => {
            this.refreshLyric(true, true);

            if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                if (musicItem) {
                    LyricUtil.setStatusBarLyricText(
                        `${musicItem.title} - ${musicItem.artist}`,);
                } else {
                    LyricUtil.setStatusBarLyricText("MusicFree");
                }
            }
        });

        // 防止重复注册：先移除旧监听
        if (this.progressSubscription) {
            try {
                this.progressSubscription.remove();
            } catch {}
            this.progressSubscription = null;
        }

        this.progressSubscription = RNTrackPlayer.addEventListener(Event.PlaybackProgressUpdated, evt => {
            const parser = this.lyricParser;
            if (!parser || !this.trackPlayer.isCurrentMusic(parser.musicItem)) {
                return;
            }

            // 节流：500ms 内不重复处理（避免每秒高频触发导致内存增长/重渲染抖动）
            const now = Date.now();
            if (now - this.lastProgressUpdateTs < 500) {
                return;
            }
            this.lastProgressUpdateTs = now;

            const currentLyricItem = getDefaultStore().get(currentLyricItemAtom);
            const newLyricItem = parser.getPosition(evt.position);

            if (currentLyricItem?.lrc !== newLyricItem?.lrc) {
                // 更新当前歌词状态
                getDefaultStore().set(currentLyricItemAtom, newLyricItem ?? null);

                // 更新状态栏歌词
                const showTranslation = PersistStatus.get("lyric.showTranslation");

                if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                    LyricUtil.setStatusBarLyricText(
                        (newLyricItem?.lrc ?? "") +
                        (showTranslation
                            ? `\n${newLyricItem?.translation ?? ""}`
                            : ""),
                    );
                }
            }
        });
        
        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            const statusBarLyricConfig = {
                topPercent: this.appConfig.getConfig("lyric.topPercent"),
                leftPercent: this.appConfig.getConfig("lyric.leftPercent"),
                align: this.appConfig.getConfig("lyric.align"),
                color: this.appConfig.getConfig("lyric.color"),
                backgroundColor: this.appConfig.getConfig("lyric.backgroundColor"),
                widthPercent: this.appConfig.getConfig("lyric.widthPercent"),
                fontSize: this.appConfig.getConfig("lyric.fontSize"),
            };
            LyricUtil.showStatusBarLyric(
                "MusicFree",
                statusBarLyricConfig ?? {}
            );
        }

        this.refreshLyric(true);
    }

    /**
     * 销毁监听，避免内存泄漏
     */
    teardown() {
        if (this.progressSubscription) {
            try {
                this.progressSubscription.remove();
            } catch {}
            this.progressSubscription = null;
        }
    }

    associateLyric(musicItem: IMusic.IMusicItem, linkToMusicItem: ICommon.IMediaBase) {
        if (!musicItem || !linkToMusicItem) {
            return false;
        }

        // 如果当前音乐项和关联的音乐项相同，则不需要重新关联
        if (isSameMediaItem(musicItem, linkToMusicItem)) {
            patchMediaExtra(musicItem, {
                associatedLrc: undefined,
            });
            return false;
        } else {
            patchMediaExtra(musicItem, {
                associatedLrc: linkToMusicItem,
            });
            if (this.trackPlayer.isCurrentMusic(musicItem)) {
                this.refreshLyric(false);
            }
            return true;
        }
    }

    unassociateLyric(musicItem: IMusic.IMusicItem) {
        if (!musicItem) {
            return;
        }

        patchMediaExtra(musicItem, {
            associatedLrc: undefined,
        });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false);
        }
    }

    async uploadLocalLyric(musicItem: IMusic.IMusicItem, lyricContent: string, type: "raw" | "translation" = "raw") {
        if (!musicItem) {
            return;
        }

        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash: string = CryptoJs.MD5(musicItem.id).toString(
            CryptoJs.enc.Hex,
        );

        // 检查是否缓存文件夹存在
        await checkAndCreateDir(pathConst.localLrcPath + platformHash);
        await writeFile(pathConst.localLrcPath +
            platformHash +
            "/" +
            idHash +
            (type === "raw" ? "" : ".tran") +
            ".lrc", lyricContent, "utf8");

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false, false);
        }
    }

    async removeLocalLyric(musicItem: IMusic.IMusicItem) {
        if (!musicItem) {
            return;
        }

        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash: string = CryptoJs.MD5(musicItem.id).toString(
            CryptoJs.enc.Hex,
        );

        const basePath =
            pathConst.localLrcPath + platformHash + "/" + idHash;

        await unlink(basePath + ".lrc").catch(() => { });
        await unlink(basePath + ".tran.lrc").catch(() => { });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false, false);
        }

    }


    updateLyricOffset(musicItem: IMusic.IMusicItem, offset: number) {
        if (!musicItem) {
            return;
        }

        // 更新歌词偏移
        patchMediaExtra(musicItem, {
            lyricOffset: offset,
        });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(true, false);
        }
    }

    private setLyricAsLoadingState() {
        getDefaultStore().set(lyricStateAtom, {
            loading: true,
            lyrics: [],
            hasTranslation: false,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
    }

    private setLyricAsNoLyricState() {
        getDefaultStore().set(lyricStateAtom, {
            loading: false,
            lyrics: [],
            hasTranslation: false,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            const musicItem = this.trackPlayer.currentMusic;
            LyricUtil.setStatusBarLyricText(musicItem ? `${musicItem.title} - ${musicItem.artist}` : "MusicFree");
        }
    }

    // ================= GD 歌词优先与歌词匹配校验 =================
    private static TRAD_TO_SIMPLE: Record<string, string> = {"倫":"伦","傑":"杰","葉":"叶","黃":"黄","陳":"陈","張":"张","劉":"刘","楊":"杨","吳":"吴","鄭":"郑","馬":"马","謝":"谢","蘇":"苏","許":"许","趙":"赵","錢":"钱","孫":"孙","萬":"万","軍":"军","國":"国","華":"华","漢":"汉","愛":"爱","會":"会","還":"还","這":"这","個":"个","們":"们","來":"来","為":"为","麼":"么","說":"说","時":"时","間":"间","點":"点","龍":"龙","鳳":"凤","夢":"梦","獨":"独","潔":"洁","純":"纯","靜":"静","樂":"乐","館":"馆","觀":"观","歡":"欢","發":"发","長":"长","門":"门","問":"问","開":"开","關":"关","對":"对","錯":"错","過":"过","遠":"远","邊":"边","讓":"让","請":"请","詩":"诗","詞":"词","語":"语","話":"话","讀":"读","寫":"写","學":"学","習":"习","書":"书","畫":"画","紙":"纸","筆":"笔","電":"电","腦":"脑","機":"机","車":"车","輪":"轮","飛":"飞","風":"风","雲":"云","興":"兴","東":"东","頭":"头","兒":"儿","轉":"转","歷":"历","單":"单","雙":"双","聲":"声","聽":"听","歸":"归","舊":"旧","廣":"广","園":"园","燈":"灯","號":"号","線":"线","紅":"红","綠":"绿","藍":"蓝","銀":"银","鋼":"钢","錄":"录","簡":"简","編":"编","維":"维","結":"结","網":"网","組":"组","總":"总","經":"经","絕":"绝","續":"续","繼":"继","約":"约","級":"级","紀":"纪","繞":"绕","緣":"缘","縮":"缩","議":"议","譯":"译","護":"护","買":"买","賣":"卖","贊":"赞","貝":"贝","貴":"贵","賓":"宾","賬":"账","贈":"赠","質":"质","賭":"赌","贏":"赢","賢":"贤","賴":"赖","躍":"跃","認":"认","誤":"误","誘":"诱","謊":"谎","謙":"谦","證":"证","譚":"谭","譜":"谱","響":"响","項":"项","順":"顺","須":"须","預":"预","頑":"顽","顧":"顾","顫":"颤","顯":"显","驗":"验","驚":"惊","騙":"骗","體":"体","髮":"发","鬍":"胡","魚":"鱼","魯":"鲁","鯊":"鲨","鯨":"鲸","鳥":"鸟","鴨":"鸭","鶯":"莺","鶴":"鹤","麥":"麦","麻":"麻","黑":"黑","齊":"齐","齒":"齿","齣":"出","龜":"龟","鼓":"鼓","臺":"台","颱":"台","鵬":"鹏","鷹":"鹰","麗":"丽","麋":"麋"};

    private static normalizeText(str: string | undefined | null): string {
        const s = String(str ?? "");
        let out = "";
        for (let i = 0; i < s.length; i++) {
            const ch = s.charAt(i);
            out += LyricManager.TRAD_TO_SIMPLE[ch] || ch;
        }
        return out
            .toLowerCase()
            .replace(/[\s\u3000]/g, "")
            .replace(/[（(\【\[][\s\S]*?[）)\】\]]/g, "")
            .replace(/[，。、；：！？!?·,'"“”‘’\-—~：]/g, "");
    }

    /**
     * 归一化后的「标题相同 + 歌手有交集」双重判定，避免同名但不同歌手/版本的歌词错版。
     */
    private static isSameSongLyric(
        a: { title?: string; artist?: string } | undefined | null,
        b: { title?: string; artist?: string } | undefined | null,
    ): boolean {
        if (!a || !b) return false;
        const tA = LyricManager.normalizeText(a.title);
        const tB = LyricManager.normalizeText(b.title);
        if (!tA || tA !== tB) return false;
        const arA = LyricManager.normalizeText(a.artist);
        const arB = LyricManager.normalizeText(b.artist);
        if (!arA || !arB) return true;
        return arA.includes(arB) || arB.includes(arA);
    }

    /**
     * 获取 GD 音乐台插件（如果存在并支持 getLyric）。
     */
    private getGDLyricPlugin(): Plugin | null {
        try {
            const p = this.pluginManager.getByName("GD音乐台");
            if (p && p.methods && typeof (p.methods as any).getLyric === "function") {
                return p as Plugin;
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    /**
     * 通过 GD 插件按「歌名 + 歌手」重新搜索，命中与当前歌相同的条目后，再用 GD 取歌词。
     * 用于：非 GD 平台导入的歌曲 / 原 getLyric 返回错版歌词 / 当前 item 缺少 _gdId。
     */
    private async getLyricFromGD(musicItem: IMusic.IMusicItem): Promise<ILyric.ILyricSource | null> {
        const gdPlugin = this.getGDLyricPlugin();
        const searchFn = (gdPlugin?.methods as any)?.search;
        const getLyricFn = (gdPlugin?.methods as any)?.getLyric;
        if (!gdPlugin || typeof searchFn !== "function" || typeof getLyricFn !== "function") {
            return null;
        }
        const keyword = `${musicItem.title ?? ""} ${musicItem.artist ?? ""}`.trim();
        if (!keyword) return null;
        let searchResult: any = null;
        try {
            searchResult = await searchFn(keyword, 1, "music");
        } catch {
            return null;
        }
        const list: Array<{ title?: string; artist?: string; [k: string]: any }> =
            (searchResult && Array.isArray(searchResult.data)) ? searchResult.data : [];
        if (!list.length) return null;
        for (const candidate of list) {
            if (!LyricManager.isSameSongLyric(candidate, musicItem)) continue;
            let lyric: ILyric.ILyricSource | null = null;
            try {
                lyric = (await getLyricFn(candidate)) ?? null;
            } catch {
                lyric = null;
            }
            if (lyric && (lyric as any).rawLrc && typeof (lyric as any).rawLrc === "string" && !(lyric as any).rawLrc.includes("暂无歌词")) {
                return lyric;
            }
        }
        return null;
    }

    private async refreshLyric(skipFetchLyricSourceIfSame: boolean = true, ignoreProgress: boolean = false) {
        const currentMusicItem = this.trackPlayer.currentMusic;

        // 如果没有当前音乐项，重置歌词状态
        if (!currentMusicItem) {
            this.setLyricAsNoLyricState();
            return;
        }

        try {
            let lrcSource: ILyric.ILyricSource | null;

            if (skipFetchLyricSourceIfSame && this.lyricParser && this.trackPlayer.isCurrentMusic(this.lyricParser.musicItem)) {
                lrcSource = this.lyricParser.lyricSource ?? null;
            } else {
                // 重置歌词状态
                this.setLyricAsLoadingState();

                // GD 歌词优先：
                //   - platform==GD音乐台 或 item 带 _gdId/_gdLyricId → 直接用 GD getLyric
                //     失败时退回到 GD search+getLyric 兜底；
                //   - 其他平台（导入歌单的歌曲）→ 一律先走 GD search+getLyric，
                //     再失败才回退导入平台插件的 getLyric。
                const hasGDTags: boolean =
                    currentMusicItem.platform === "GD音乐台" ||
                    Boolean((currentMusicItem as any)._gdId || (currentMusicItem as any)._gdLyricId);

                if (hasGDTags) {
                    const gdPlugin = this.getGDLyricPlugin();
                    if (gdPlugin) {
                        try {
                            const gdLyric = await (gdPlugin.methods as any).getLyric(currentMusicItem);
                            if (gdLyric && gdLyric.rawLrc && !gdLyric.rawLrc.includes("暂无歌词")) {
                                lrcSource = gdLyric;
                            } else {
                                lrcSource = await this.getLyricFromGD(currentMusicItem);
                            }
                        } catch {
                            lrcSource = await this.getLyricFromGD(currentMusicItem);
                        }
                    } else {
                        lrcSource = null;
                    }
                } else {
                    lrcSource = await this.getLyricFromGD(currentMusicItem);
                }

                if (!lrcSource) {
                    const rawPlugin = this.pluginManager.getByMedia(currentMusicItem);
                    if (rawPlugin?.methods && typeof (rawPlugin.methods as any).getLyric === "function") {
                        try {
                            const rawLyric = (await (rawPlugin.methods as any).getLyric(currentMusicItem)) ?? null;
                            if (rawLyric && rawLyric.rawLrc && !rawLyric.rawLrc.includes("暂无歌词")) {
                                lrcSource = rawLyric;
                            }
                        } catch {
                            lrcSource = null;
                        }
                    }
                }
            }

            // 切换到其他歌曲了, 直接返回
            if (!this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                return;
            }

            // 如果歌词源不存在，并且开启自动搜索歌词
            if (!lrcSource && this.appConfig.getConfig("lyric.autoSearchLyric")) {
                // 重置歌词状态
                this.setLyricAsLoadingState();

                lrcSource = await this.searchSimilarLyric(currentMusicItem);
            }

            // 切换到其他歌曲了, 直接返回
            if (!this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                return;
            }

            // 如果源不存在，尝试从 NetA 获取（哪吒互联元数据服务）
            if (!lrcSource && NetAMetadata.isSupported()) {
                lrcSource = await this.fetchLyricFromNetA(currentMusicItem);
            }

            // 切换到其他歌曲了, 直接返回
            if (!this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                return;
            }

            // 如果源不存在，恢复默认设置
            if (!lrcSource) {
                this.setLyricAsNoLyricState();
                this.lyricParser = null;
                return;
            }

            this.lyricParser = new LyricParser(lrcSource.rawLrc!, {
                extra: {
                    offset: (getMediaExtraProperty(currentMusicItem, "lyricOffset") || 0) * -1,
                },
                musicItem: currentMusicItem,
                lyricSource: lrcSource,
                translation: lrcSource.translation,
            });

            getDefaultStore().set(lyricStateAtom, {
                loading: false,
                lyrics: this.lyricParser.getLyricItems(),
                hasTranslation: !!lrcSource.translation,
                meta: this.lyricParser.getMeta(),
            });

            const currentLyric = ignoreProgress ? (this.lyricParser.getLyricItems()?.[0] ?? null) : this.lyricParser.getPosition((await this.trackPlayer.getProgress()).position);
            getDefaultStore().set(currentLyricItemAtom, currentLyric || null);

            if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                if (currentLyric) {
                    LyricUtil.setStatusBarLyricText(
                        (currentLyric?.lrc ?? "") +
                        (this.lyricParser.hasTranslation
                            ? `\n${currentLyric?.translation ?? ""}`
                            : ""),
                    );
                } else {
                    const musicItem = this.trackPlayer.currentMusic;
                    LyricUtil.setStatusBarLyricText(musicItem ? `${musicItem.title} - ${musicItem.artist}` : "MusicFree");
                }
            }
        } catch (err) {
            if (this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
            }
        }
    }

    /**
     * 检索最接近的歌词
     * @param musicItem 
     * @returns 
     */
    private async searchSimilarLyric(musicItem: IMusic.IMusicItem) {
        const keyword = musicItem.alias || musicItem.title;
        // 歌词相似搜索也强制 GD 优先：把 GD 插件置顶，其他插件顺序不变。
        const allPlugins = this.pluginManager.getSearchablePlugins("lyric");
        const plugins = [...allPlugins].sort((a, b) => {
            const aIsGD = a.name === "GD音乐台" ? 0 : 1;
            const bIsGD = b.name === "GD音乐台" ? 0 : 1;
            return aIsGD - bIsGD;
        });

        let distance = Infinity;
        let minDistanceMusicItem;
        let targetPlugin: Plugin | null = null;

        for (let plugin of plugins) {
            // 如果插件不是当前音乐的插件，或者当前音乐不是正在播放的音乐，则跳过
            if (
                !this.trackPlayer.isCurrentMusic(musicItem)
            ) {
                return null;
            }

            if (plugin.name === musicItem.platform) {
                // 如果插件是当前音乐的插件，则跳过
                continue;
            }

            const results = await plugin.methods
                .search(keyword, 1, "lyric")
                .catch(() => null);

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                // 使用归一化后的「标题+歌手」双重判断，避免括号/繁简/空格差异造成的误选
                if (LyricManager.isSameSongLyric(item, musicItem)) {
                    distance = 0;
                    minDistanceMusicItem = item;
                    targetPlugin = plugin;
                    break;
                } else {
                    const normKeyword = LyricManager.normalizeText(keyword);
                    const normTitle = LyricManager.normalizeText(item.title);
                    const normItemArtist = LyricManager.normalizeText(item.artist);
                    const normArtist = LyricManager.normalizeText(musicItem.artist);
                    const dist =
                        minDistance(normKeyword, normTitle) +
                        minDistance(normItemArtist, normArtist);
                    if (dist < distance) {
                        distance = dist;
                        minDistanceMusicItem = item;
                        targetPlugin = plugin;
                    }
                }
            }

            if (distance === 0) {
                break;
            }
        }

        if (minDistanceMusicItem && targetPlugin) {
            return await targetPlugin.methods
                .getLyric(minDistanceMusicItem)
                .catch(() => null);
        }

        return null;
    }

    /**
     * 从 NetA 哪吒互联元数据服务获取歌词
     * @param musicItem 音乐项
     * @returns 歌词源或 null
     */
    private async fetchLyricFromNetA(musicItem: IMusic.IMusicItem): Promise<ILyric.ILyricSource | null> {
        if (!musicItem?.title || !NetAMetadata.isSupported()) {
            return null;
        }

        try {
            const title = musicItem.alias || musicItem.title;
            const artist = musicItem.artist || "";
            const result = await NetAMetadata.getLyric(title, artist);

            if (result && result.rawLrc) {
                return {
                    rawLrc: result.rawLrc,
                };
            }
            return null;
        } catch {
            return null;
        }
    }

}

const lyricManager = new LyricManager();
export default lyricManager;


export const useLyricState = () => useAtomValue(lyricStateAtom);
export const useCurrentLyricItem = () => useAtomValue(currentLyricItemAtom);