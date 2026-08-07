import { Platform } from "react-native";
import FastImage from "react-native-fast-image";
import { trace, errorLog } from "./log";
import getOrCreateMMKV from "./getOrCreateMMKV";
import { clearCache } from "./fileUtils";

const MMKV = getOrCreateMMKV("memory.monitor");
const HISTORY_KEY = "memory.history";
const MAX_HISTORY = 20;

let monitorTimer: any = null;
let sampleCount = 0;
let lastRss: number | null = null;
let risingCount = 0;
let lastCleanupTime = 0;
let cleanupConfig: {
    enabled: boolean;
    thresholdMB: number;
    intervalMin: number;
} = {
    enabled: true,
    thresholdMB: 400,
    intervalMin: 30,
};

export interface IMemorySnapshot {
    ts: number;
    rss: number;
    heapTotal: number;
    heapUsed: number;
}

function getSnapshot(): IMemorySnapshot | null {
    try {
        // @ts-ignore - performance.memory 在 Hermes 上存在但类型未声明
        const mem = (global as any).performance?.memory;
        if (mem && typeof mem.usedJSHeapSize === "number") {
            return {
                ts: Date.now(),
                rss: mem.usedJSHeapSize / 1024 / 1024,
                heapTotal: mem.totalJSHeapSize / 1024 / 1024,
                heapUsed: mem.usedJSHeapSize / 1024 / 1024,
            };
        }
    } catch {}
    return null;
}

function fmt(n: number): string {
    return n.toFixed(2) + "MB";
}

function checkLeak(snapshot: IMemorySnapshot) {
    if (lastRss !== null) {
        if (snapshot.rss > lastRss) {
            risingCount++;
        } else {
            risingCount = 0;
        }

        if (risingCount >= 3) {
            errorLog("内存持续上升，可能存在泄漏", {
                current: fmt(snapshot.rss),
                risingCount,
            });
        }
    }
    lastRss = snapshot.rss;
}

function saveSnapshot(snapshot: IMemorySnapshot) {
    try {
        const raw = MMKV.getString(HISTORY_KEY);
        const history: IMemorySnapshot[] = raw ? JSON.parse(raw) : [];
        history.push(snapshot);
        if (history.length > MAX_HISTORY) {
            history.splice(0, history.length - MAX_HISTORY);
        }
        MMKV.set(HISTORY_KEY, JSON.stringify(history));
    } catch {}
}

/**
 * 执行内存清理
 * 清理图片缓存、歌词缓存，触发 JS 垃圾回收
 */
async function performCleanup(reason: string) {
    trace(`[MemoryCleanup] 开始清理 (${reason})`);
    const before = getSnapshot();

    try {
        // 1. 清理图片磁盘缓存（最大占用项）
        try {
            await FastImage.clearDiskCache();
            trace("[MemoryCleanup] 图片磁盘缓存已清理");
        } catch (e) {
            trace("[MemoryCleanup] 清理图片缓存失败:", e);
        }

        // 2. 清理图片内存缓存
        try {
            FastImage.clearMemoryCache();
            trace("[MemoryCleanup] 图片内存缓存已清理");
        } catch (e) {
            trace("[MemoryCleanup] 清理图片内存缓存失败:", e);
        }

        // 3. 清理歌词缓存
        try {
            await clearCache("lyric");
            trace("[MemoryCleanup] 歌词缓存已清理");
        } catch (e) {
            trace("[MemoryCleanup] 清理歌词缓存失败:", e);
        }

        // 4. 尝试 JS 垃圾回收
        try {
            // @ts-ignore
            if (global.gc) {
                // @ts-ignore
                global.gc();
                trace("[MemoryCleanup] JS GC 已触发");
            }
        } catch {}

        const after = getSnapshot();
        if (before && after) {
            const freed = before.rss - after.rss;
            trace(
                `[MemoryCleanup] 清理完成 RSS: ${fmt(before.rss)} → ${fmt(after.rss)} (释放 ${fmt(Math.max(0, freed))})`,
            );
        } else {
            trace("[MemoryCleanup] 清理完成");
        }
    } catch (e) {
        errorLog("[MemoryCleanup] 清理过程出错", e);
    }

    lastCleanupTime = Date.now();
}

/**
 * 检查是否需要执行清理
 * 两种触发条件：
 * 1. RSS 超过阈值（紧急清理）
 * 2. 距上次清理超过间隔时间（定期清理）
 */
function checkAndCleanup(snapshot: IMemorySnapshot) {
    if (!cleanupConfig.enabled) {
        return;
    }

    const now = Date.now();
    const intervalMs = cleanupConfig.intervalMin * 60 * 1000;
    const timeSinceLastCleanup = now - lastCleanupTime;

    // 条件 1：内存超过阈值
    if (snapshot.rss > cleanupConfig.thresholdMB) {
        trace(
            `[MemoryCleanup] RSS ${fmt(snapshot.rss)} 超过阈值 ${cleanupConfig.thresholdMB}MB，执行清理`,
        );
        performCleanup("threshold:" + cleanupConfig.thresholdMB);
        return;
    }

    // 条件 2：超过定时间隔（轻量清理）
    if (timeSinceLastCleanup > intervalMs) {
        trace(
            `[MemoryCleanup] 定时清理触发（距上次 ${Math.round(timeSinceLastCleanup / 60000)} 分钟）`,
        );
        performCleanup("interval:" + cleanupConfig.intervalMin + "min");
    }
}

function sample() {
    const snapshot = getSnapshot();
    if (!snapshot) {
        return;
    }

    sampleCount++;
    const timeLabel = `#${sampleCount}`;
    trace(
        `[MemoryMonitor] ${timeLabel} RSS=${fmt(snapshot.rss)} heap=${fmt(snapshot.heapTotal)} heapUsed=${fmt(snapshot.heapUsed)}`,
    );

    checkLeak(snapshot);
    saveSnapshot(snapshot);
    checkAndCleanup(snapshot);
}

export function startMemoryMonitor(intervalMs: number = 5 * 60 * 1000) {
    if (monitorTimer) {
        return;
    }
    if (Platform.OS !== "android") {
        return;
    }
    trace("[MemoryMonitor] 启动内存监控，间隔", intervalMs / 1000 + "秒");
    sample();
    monitorTimer = setInterval(sample, intervalMs);
}

export function stopMemoryMonitor() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
}

/**
 * 更新清理配置
 */
export function updateCleanupConfig(config: Partial<typeof cleanupConfig>) {
    cleanupConfig = { ...cleanupConfig, ...config };
    trace(
        `[MemoryCleanup] 配置更新: enabled=${cleanupConfig.enabled}, threshold=${cleanupConfig.thresholdMB}MB, interval=${cleanupConfig.intervalMin}min`,
    );
}

/**
 * 获取当前清理配置
 */
export function getCleanupConfig() {
    return { ...cleanupConfig };
}

/**
 * 手动触发清理
 */
export async function manualCleanup() {
    await performCleanup("manual");
}

export function getMemoryHistory(): IMemorySnapshot[] {
    try {
        const raw = MMKV.getString(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function logMemorySnapshot() {
    const snapshot = getSnapshot();
    if (!snapshot) {
        trace("[MemoryMonitor] 当前环境不支持内存采样");
        return null;
    }
    trace(
        `[MemoryMonitor] 手动采样 RSS=${fmt(snapshot.rss)} heap=${fmt(snapshot.heapTotal)} heapUsed=${fmt(snapshot.heapUsed)}`,
    );
    saveSnapshot(snapshot);
    return snapshot;
}

export default {
    startMemoryMonitor,
    stopMemoryMonitor,
    getMemoryHistory,
    logMemorySnapshot,
    updateCleanupConfig,
    getCleanupConfig,
    manualCleanup,
};
