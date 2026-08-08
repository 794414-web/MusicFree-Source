import { FullscreenNotificationModule } from "@/native/nezha";

/**
 * 车机全屏通知状态管理
 *
 * 响应 FULLSCREEN_ON / FULLSCREEN_OFF 广播，
 * 控制应用的全屏显示状态。
 */

let currentFullscreenState: boolean = false;

type StateListener = (isFullscreen: boolean) => void;
const listeners = new Set<StateListener>();

/**
 * 设置为全屏模式
 * 由车机 FULLSCREEN_ON 广播触发
 */
export function setWindowFullscreen() {
    if (currentFullscreenState) return;
    currentFullscreenState = true;
    listeners.forEach((fn) => {
        try {
            fn(true);
        } catch {}
    });
}

/**
 * 退出全屏模式
 * 由车机 FULLSCREEN_OFF 广播触发
 */
export function exitWindowFullscreen() {
    if (!currentFullscreenState) return;
    currentFullscreenState = false;
    listeners.forEach((fn) => {
        try {
            fn(false);
        } catch {}
    });
}

/**
 * 查询当前是否为全屏状态
 */
export function isFullscreen(): boolean {
    return currentFullscreenState;
}

/**
 * 监听全屏状态变化
 * @returns 取消监听函数
 */
export function addFullscreenListener(listener: StateListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * 初始化：同步一次原生层状态
 */
export async function initFullscreenState(): Promise<void> {
    try {
        const state = await FullscreenNotificationModule.getCurrentState();
        currentFullscreenState = state === "on";
    } catch {
        // ignore
    }
}