const timeReg = /\[[\d:.]+\]/g;
const metaReg = /\[(.+):(.+)\]/g;

type LyricMeta = Record<string, any>;

interface IOptions {
    musicItem?: IMusic.IMusicItem;
    lyricSource?: ILyric.ILyricSource;
    translation?: string;
    extra?: Record<string, any>;
}

export interface IParsedLrcItem {
    /** 时间 s */
    time: number;
    /** 歌词 */
    lrc: string;
    /** 翻译 */
    translation?: string;
    /** 位置 */
    index: number;
}

export default class LyricParser {
    private _musicItem?: IMusic.IMusicItem;

    private meta: LyricMeta;
    private lrcItems: Array<IParsedLrcItem>;

    private extra: Record<string, any>;

    private lastSearchIndex = 0;

    public hasTranslation = false;
    public lyricSource?: ILyric.ILyricSource;

    get musicItem() {
        return this._musicItem;
    }

    constructor(raw: string, options?: IOptions) {
        // init
        this._musicItem = options?.musicItem;
        this.extra = options?.extra || {};
        this.lyricSource = options?.lyricSource;

        let translation = options?.translation;
        if (!raw && translation) {
            raw = translation;
            translation = undefined;
        }

        const { lrcItems, meta } = this.parseLyricImpl(raw);
        if (this.extra.offset) {
            meta.offset = (meta.offset ?? 0) + this.extra.offset;
        }
        this.meta = meta;
        this.lrcItems = lrcItems;

        if (translation) {
            this.hasTranslation = true;
            const transLrcItems = this.parseLyricImpl(translation).lrcItems;

            // TLRC 容差匹配：原主/译 LRC 时间戳在不同源可能因 2dp/3dp 格式差异导致±50ms 错位，
            // 严格 === 匹配会让所有翻译为空。这里用「最近邻 + 250ms 容差 + 单调指针」策略。
            const TOLERANCE = 0.25;
            let p1 = 0;
            let p2 = 0;

            while (p1 < this.lrcItems.length && transLrcItems.length) {
                const lrcItem = this.lrcItems[p1];
                // 先推进到不小于目标时间的翻译行
                while (
                    p2 < transLrcItems.length - 1 &&
                    transLrcItems[p2].time + 1e-9 < lrcItem.time - TOLERANCE
                ) {
                    ++p2;
                }
                // 在 p2 周围 1 格范围内找最近（避免因撑开导致越过阈值）
                let bestIdx = p2;
                let bestDiff = Math.abs(transLrcItems[p2].time - lrcItem.time);
                for (let d = -1; d <= 1; d++) {
                    const cand = p2 + d;
                    if (cand >= 0 && cand < transLrcItems.length) {
                        const diff = Math.abs(transLrcItems[cand].time - lrcItem.time);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestIdx = cand;
                        }
                    }
                }
                if (bestDiff <= TOLERANCE) {
                    lrcItem.translation = transLrcItems[bestIdx].lrc;
                } else {
                    lrcItem.translation = "";
                }

                ++p1;
            }
        }
    }

    getPosition(position: number): IParsedLrcItem | null {
        position = position - (this.meta?.offset ?? 0);
        let index;
        /** 最前面 */
        if (!this.lrcItems[0] || position < this.lrcItems[0].time) {
            this.lastSearchIndex = 0;
            return null;
        }
        for (
            index = this.lastSearchIndex;
            index < this.lrcItems.length - 1;
            ++index
        ) {
            if (
                position >= this.lrcItems[index].time &&
                position < this.lrcItems[index + 1].time
            ) {
                this.lastSearchIndex = index;
                return this.lrcItems[index];
            }
        }

        for (index = 0; index < this.lastSearchIndex; ++index) {
            if (
                position >= this.lrcItems[index].time &&
                position < this.lrcItems[index + 1].time
            ) {
                this.lastSearchIndex = index;
                return this.lrcItems[index];
            }
        }

        index = this.lrcItems.length - 1;
        this.lastSearchIndex = index;
        return this.lrcItems[index];
    }

    getLyricItems() {
        return this.lrcItems;
    }

    getMeta() {
        return this.meta;
    }

    toString(options?: {
        withTimestamp?: boolean;
        type?: "raw" | "translation";
    }) {
        const { type = "raw", withTimestamp = true } = options || {};

        if (withTimestamp) {
            return this.lrcItems
                .map(
                    item =>
                        `${this.timeToLrctime(item.time)} ${
                            type === "raw" ? item.lrc : item.translation
                        }`,
                )
                .join("\r\n");
        } else {
            return this.lrcItems
                .map(item => (type === "raw" ? item.lrc : item.translation))
                .join("\r\n");
        }
    }

    /** [xx:xx.xx] => x s */
    private parseTime(timeStr: string): number {
        // [mm:ss.fff] / [mm:ss.cc] / [mm:ss] / [hh:mm:ss.xxx]
        const inner = timeStr.slice(1, timeStr.length - 1).trim();
        const colonCount = (inner.match(/:/g) || []).length;
        let seconds: number;
        if (colonCount === 2) {
            const [h, m, rest] = inner.split(":");
            seconds = Number(h) * 3600 + Number(m) * 60 + this.parseSecondsWithFrac(rest);
        } else if (colonCount === 1) {
            const [m, rest] = inner.split(":");
            seconds = Number(m) * 60 + this.parseSecondsWithFrac(rest);
        } else {
            seconds = Number(inner);
        }
        if (!isFinite(seconds)) {
            return 0;
        }
        return Math.max(0, seconds);
    }

    /**
     * 解析「秒.小数」部分，按小数位数定权：
     *   - 0 位小数（纯整数）→ 秒
     *   - 1 位小数  → 十分秒 × 0.1
     *   - 2 位小数  → 百分秒 × 0.01   // 网易云 / GD 常见格式
     *   - 3 位小数  → 毫秒   × 0.001  // 酷狗/QRC 常见格式
     *   - 4+ 位小数 → 按 10^-n 通用处理
     */
    private parseSecondsWithFrac(secStr: string): number {
        if (!secStr) return 0;
        const dot = secStr.indexOf(".");
        if (dot === -1) {
            const n = Number(secStr);
            return isFinite(n) ? n : 0;
        }
        const intPart = Number(secStr.slice(0, dot)) || 0;
        const fracRaw = secStr.slice(dot + 1);
        if (!fracRaw) return intPart;
        // 末尾只保留数字（过滤偶尔混入的逗号等），取前 5 位防异常
        const digits = fracRaw.replace(/\D/g, "").slice(0, 5);
        if (!digits) return intPart;
        const frac = Number(digits) / Math.pow(10, digits.length);
        return intPart + frac;
    }

    /** x s => [xx:xx.xx] */
    private timeToLrctime(sec: number) {
        const min = Math.floor(sec / 60);
        sec = sec - min * 60;
        const secInt = Math.floor(sec);
        const secFloat = sec - secInt;
        return `[${min.toFixed(0).padStart(2, "0")}:${secInt
            .toString()
            .padStart(2, "0")}.${secFloat.toFixed(2).slice(2)}]`;
    }

    private parseMetaImpl(metaStr: string) {
        if (metaStr === "") {
            return {};
        }
        const metaArr = metaStr.match(metaReg) ?? [];
        const meta: any = {};
        let k, v;
        for (const m of metaArr) {
            k = m.substring(1, m.indexOf(":"));
            v = m.substring(k.length + 2, m.length - 1);
            if (k === "offset") {
                meta[k] = +v / 1000;
            } else {
                meta[k] = v;
            }
        }
        return meta;
    }

    private parseLyricImpl(raw: string) {
        raw = raw.trim();
        const rawLrcItems: Array<IParsedLrcItem> = [];
        const rawLrcs = raw.split(timeReg) ?? [];
        const rawTimes = raw.match(timeReg) ?? [];
        const len = rawTimes.length;

        const meta = this.parseMetaImpl(rawLrcs[0].trim());
        rawLrcs.shift();

        let counter = 0;
        let j, lrc;
        for (let i = 0; i < len; ++i) {
            counter = 0;
            while (rawLrcs[0] === "") {
                ++counter;
                rawLrcs.shift();
            }
            lrc = rawLrcs[0]?.trim?.() ?? "";
            for (j = i; j < i + counter; ++j) {
                rawLrcItems.push({
                    time: this.parseTime(rawTimes[j]),
                    lrc,
                    index: j,
                });
            }
            i += counter;
            if (i < len) {
                rawLrcItems.push({
                    time: this.parseTime(rawTimes[i]),
                    lrc,
                    index: j,
                });
            }
            rawLrcs.shift();
        }
        let lrcItems = rawLrcItems.sort((a, b) => a.time - b.time);

        // ---- GD-origin / 通用 LRC 时间戳精度校正 ----
        // 1) 去空行：纯空白、纯标点占位行（但保留时间戳本身，因为空 LRC 在暂停/前奏时仍会跳到 index -1）
        //    注意不要过度过滤，避免误删「呼吸间奏 ～」这类特效词
        lrcItems = lrcItems.filter(it => !!String(it.lrc ?? "").trim());

        // 2) 冲突时间戳撑开：同一秒被多句共用（网易云 2 位厘秒解析常见的「精度截断导致同秒」），
        //    按句数均分 1.0s 区间，保证每句至少 167ms 可触发；
        //    也可处理 GD 偶尔返回两句完全相同时间戳的情况。
        if (lrcItems.length > 1) {
            for (let i = 0; i < lrcItems.length; i++) {
                let j = i + 1;
                while (j < lrcItems.length && lrcItems[j].time <= lrcItems[i].time) {
                    j++;
                }
                // [i, j) 区间都是 ≤ lrcItems[i].time 的冲突组（含本身）
                const groupSize = j - i;
                if (groupSize > 1) {
                    // 决定本组结束时间：下一组时间 - epsilon，或本组起点+1.0s
                    const nextTime = j < lrcItems.length ? lrcItems[j].time : (lrcItems[i].time + 1.0);
                    const span = Math.max(0.25, nextTime - lrcItems[i].time);
                    for (let k = 0; k < groupSize; k++) {
                        const raw = lrcItems[i].time;
                        const spread = raw + (span * k) / groupSize;
                        lrcItems[i + k].time = spread;
                    }
                }
            }
        }

        // 3) 单调性再排序 & 赋 index
        lrcItems.sort((a, b) => a.time - b.time);
        lrcItems.forEach((item, index) => {
            item.index = index;
        });

        // 4) 「全 0 时间戳 + 非 0 总行数 < 5」异常降级：保持旧的按行均分策略（防止接口返回无时间戳 LRC）
        const allZero = lrcItems.length > 0 && lrcItems.every(x => x.time <= 1e-6);
        if (allZero && lrcItems.length >= 5) {
            // 全部 0 但行数多：说明源 LRC 丢了时间戳，按 4 秒/句做均分（GD 回退场景）
            for (let i = 0; i < lrcItems.length; i++) {
                lrcItems[i].time = i * 4.0;
            }
        } else if (lrcItems.length === 0 && raw.length) {
            lrcItems = raw.split("\n").map((_, index) => ({
                time: index * 4.0,
                lrc: _,
                index,
            }));
        }

        return {
            lrcItems,
            meta,
        };
    }
}
