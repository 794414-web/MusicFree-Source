import { Platform } from "react-native";
import { trace, errorLog } from "./log";
import getOrCreateMMKV from "./getOrCreateMMKV";

/**
 * 内存监控工具
 *
 * 定时记录 JS 堆内存使用情况，输出到 trace 日志和 MMKV，
 * 方便用户确认长时间运行后内存是否稳定。
 *
 * 日志格式示例：
 *   [MemoryMonitor] RSS=156.34MB heap=64.21MB heapUsed=42.18MB
 *
 * 判定泄漏的经验值：
 *   - 连续 3 次采样 RSS 持续上升且不回落 → 可能泄漏
 *   - heapUsed 单调上升超过 30 分钟 → 可能泄漏
 *   - 启动后 1 小时内 RSS 增长 > 50MB → 需要排查
 */

const MMKV = getOrCreateMMKV("memory.monitor");
const HISTORY_KEY = "memory.history";
const MAX_HISTORY = 20;

let monitorTimer: any = null;
let sampleCount = 0;
/** 上一次采样的 RSS，用于检测是否持续上升 */
let lastRss: number | null = null;
/** 连续上升计数 */
let risingCount = 0;

export interface IMemorySnapshot {
    /** 采样时间戳 */
    ts: number;
    /** 进程总内存（MB） */
    rss: number;
    /** JS 堆总大小（MB） */
    heapTotal: number;
    /** JS 堆已用（MB） */
    heapUsed: number;
}

/**
 * 获取当前内存快照
 * performance.memory 在 RN 0.72+ 的 Hermes 引擎上可用
 */
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

/**
 * 格式化内存数值
 */
function fmt(n: number): string {
    return n.toFixed(2) + "MB";
}

/**
 * 检测内存是否持续上升
 * 连续 3 次上升会在日志中给出警告
 */
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

/**
 * 保存采样到 MMKV（用于历史对比）
 */
function saveSnapshot(snapshot: IMemorySnapshot) {
    try {
        const raw = MMKV.getString(HISTORY_KEY);
        const history: IMemorySnapshot[] = raw ? JSON.parse(raw) : [];
        history.push(snapshot);
        // 只保留最近 MAX_HISTORY 条
        if (history.length > MAX_HISTORY) {
            history.splice(0, history.length - MAX_HISTORY);
        }
        MMKV.set(HISTORY_KEY, JSON.stringify(history));
    } catch {}
}

/**
 * 采样一次内存并记录日志
 */
function sample() {
    const snapshot = getSnapshot();
    if (!snapshot) {
        return;
    }

    sampleCount++;
    const timeLabel = `#${sampleCount}`;
    trace(`[MemoryMonitor] ${timeLabel} RSS=${fmt(snapshot.rss)} heap=${fmt(snapshot.heapTotal)} heapUsed=${fmt(snapshot.heapUsed)}`);

    checkLeak(snapshot);
    saveSnapshot(snapshot);
}

/**
 * 启动内存监控
 * @param intervalMs 采样间隔，默认 5 分钟
 */
export function startMemoryMonitor(intervalMs: number = 5 * 60 * 1000) {
    if (monitorTimer) {
        return;
    }
    if (Platform.OS !== "android") {
        return;
    }
    trace("[MemoryMonitor] 启动内存监控，间隔", intervalMs / 1000 + "秒");
    // 立即采样一次（启动基线）
    sample();
    monitorTimer = setInterval(sample, intervalMs);
}

/**
 * 停止内存监控
 */
export function stopMemoryMonitor() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
}

/**
 * 获取内存历史记录
 */
export function getMemoryHistory(): IMemorySnapshot[] {
    try {
        const raw = MMKV.getString(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/**
 * 手动打印一次内存快照（用于调试页面按钮触发）
 */
export function logMemorySnapshot() {
    const snapshot = getSnapshot();
    if (!snapshot) {
        trace("[MemoryMonitor] 当前环境不支持内存采样");
        return null;
    }
    trace(`[MemoryMonitor] 手动采样 RSS=${fmt(snapshot.rss)} heap=${fmt(snapshot.heapTotal)} heapUsed=${fmt(snapshot.heapUsed)}`);
    saveSnapshot(snapshot);
    return snapshot;
}

export default {
    startMemoryMonitor,
    stopMemoryMonitor,
    getMemoryHistory,
    logMemorySnapshot,
};
