import { NativeModule, NativeModules, Platform, DeviceEventEmitter } from 'react-native';

/**
 * 哪吒车机适配模块 TypeScript 接口
 *
 * 包含四个原生模块：
 * - NezhaTheme: 主题跟随系统（日间/夜间）
 * - SteeringWheel: 方向盘媒体按键
 * - NezhaMultiDisplay: 多屏检测
 * - FullscreenNotification: 车机全屏通知控制
 */

// ======================== 主题跟随 ========================

interface INezhaThemeModule extends NativeModule {
    /** 获取当前主题模式: "night" 或 "day" */
    getThemeMode: () => Promise<string>;
    /** 启动主题监听，启动时立即通知一次 */
    startListening: () => Promise<boolean>;
    /** 停止主题监听 */
    stopListening: () => Promise<boolean>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

const NezhaThemeNative: INezhaThemeModule | undefined = NativeModules.NezhaTheme;

function isNezhaThemeSupported(): boolean {
    return Platform.OS === 'android' && !!NezhaThemeNative;
}

export const NezhaThemeModule = {
    isSupported: isNezhaThemeSupported,

    getThemeMode: (): Promise<string> => {
        if (!NezhaThemeNative) return Promise.resolve('day');
        return NezhaThemeNative.getThemeMode().catch(() => 'day');
    },

    startListening: (): Promise<boolean> => {
        if (!NezhaThemeNative) return Promise.resolve(false);
        return NezhaThemeNative.startListening().catch(() => false);
    },

    stopListening: (): Promise<boolean> => {
        if (!NezhaThemeNative) return Promise.resolve(false);
        return NezhaThemeNative.stopListening().catch(() => false);
    },
};

// ======================== 方向盘控制 ========================

interface ISteeringWheelModule extends NativeModule {
    startListening: () => Promise<boolean>;
    stopListening: () => Promise<boolean>;
    adjustMusicVolume: (delta: number) => Promise<number>;
    getMusicVolume: () => Promise<number>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

const SteeringWheelNative: ISteeringWheelModule | undefined = NativeModules.SteeringWheel;

function isSteeringWheelSupported(): boolean {
    return Platform.OS === 'android' && !!SteeringWheelNative;
}

export const SteeringWheelModule = {
    isSupported: isSteeringWheelSupported,

    startListening: (): Promise<boolean> => {
        if (!SteeringWheelNative) return Promise.resolve(false);
        return SteeringWheelNative.startListening().catch(() => false);
    },

    stopListening: (): Promise<boolean> => {
        if (!SteeringWheelNative) return Promise.resolve(false);
        return SteeringWheelNative.stopListening().catch(() => false);
    },

    adjustMusicVolume: (delta: number): Promise<number> => {
        if (!SteeringWheelNative) return Promise.resolve(-1);
        return SteeringWheelNative.adjustMusicVolume(delta).catch(() => -1);
    },

    getMusicVolume: (): Promise<number> => {
        if (!SteeringWheelNative) return Promise.resolve(0);
        return SteeringWheelNative.getMusicVolume().catch(() => 0);
    },
};

// ======================== 多屏检测 ========================

interface DisplayInfo {
    displayId: number;
    name: string;
    width: number;
    height: number;
    isDefault: boolean;
    role: 'main' | 'vice' | 'hud' | 'unknown';
}

interface INezhaMultiDisplayModule extends NativeModule {
    getDisplays: () => Promise<DisplayInfo[]>;
    getViceDisplayId: () => Promise<number>;
    getHudDisplayId: () => Promise<number>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

const NezhaMultiDisplayNative: INezhaMultiDisplayModule | undefined = NativeModules.NezhaMultiDisplay;

function isMultiDisplaySupported(): boolean {
    return Platform.OS === 'android' && !!NezhaMultiDisplayNative;
}

export const NezhaMultiDisplayModule = {
    isSupported: isMultiDisplaySupported,

    getDisplays: (): Promise<DisplayInfo[]> => {
        if (!NezhaMultiDisplayNative) return Promise.resolve([]);
        return NezhaMultiDisplayNative.getDisplays().catch(() => []);
    },

    getViceDisplayId: (): Promise<number> => {
        if (!NezhaMultiDisplayNative) return Promise.resolve(-1);
        return NezhaMultiDisplayNative.getViceDisplayId().catch(() => -1);
    },

    getHudDisplayId: (): Promise<number> => {
        if (!NezhaMultiDisplayNative) return Promise.resolve(-1);
        return NezhaMultiDisplayNative.getHudDisplayId().catch(() => -1);
    },
};

// ======================== 全屏通知控制 ========================

interface IFullscreenNotificationModule extends NativeModule {
    startListening: () => Promise<boolean>;
    stopListening: () => Promise<boolean>;
    getCurrentState: () => Promise<string>;
    getScreenState: () => Promise<string>;
    isSupported: () => Promise<boolean>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

const FullscreenNotificationNative: IFullscreenNotificationModule | undefined = NativeModules.FullscreenNotification;

function isFullscreenNotificationSupported(): boolean {
    return Platform.OS === 'android' && !!FullscreenNotificationNative;
}

export const FullscreenNotificationModule = {
    isSupported: isFullscreenNotificationSupported,

    startListening: (): Promise<boolean> => {
        if (!FullscreenNotificationNative) return Promise.resolve(false);
        return FullscreenNotificationNative.startListening().catch(() => false);
    },

    stopListening: (): Promise<boolean> => {
        if (!FullscreenNotificationNative) return Promise.resolve(false);
        return FullscreenNotificationNative.stopListening().catch(() => false);
    },

    getCurrentState: (): Promise<string> => {
        if (!FullscreenNotificationNative) return Promise.resolve('off');
        return FullscreenNotificationNative.getCurrentState().catch(() => 'off');
    },

    getScreenState: (): Promise<string> => {
        if (!FullscreenNotificationNative) return Promise.resolve('on');
        return FullscreenNotificationNative.getScreenState().catch(() => 'on');
    },
};

// ======================== 事件类型 ========================

/** 主题变化事件参数 */
export interface NezhaThemeEvent {
    mode: 'night' | 'day';
    isNight: boolean;
}

/** 方向盘按键事件参数 */
export interface SteeringWheelKeyEvent {
    keyCode: number;
    action: 'previous' | 'next' | 'playPause' | 'play' | 'pause' | 'volumeUp' | 'volumeDown' | string;
}

/** 全屏通知状态事件参数 */
export interface FullscreenStateEvent {
    state: 'on' | 'off';
    action: 'enterFullscreen' | 'exitFullscreen';
}

/** 屏幕状态事件参数 */
export interface ScreenStateEvent {
    state: 'on' | 'off';
    action: 'screenOn' | 'screenOff';
}

// ======================== 事件订阅辅助 ========================

/**
 * 监听哪吒主题变化
 * @returns 取消监听函数
 */
export function onNezhaThemeChange(callback: (event: NezhaThemeEvent) => void): () => void {
    const subscription = DeviceEventEmitter.addListener('nezhaThemeChanged', callback);
    return () => subscription.remove();
}

/**
 * 监听方向盘媒体按键
 * @returns 取消监听函数
 */
export function onSteeringWheelKey(callback: (event: SteeringWheelKeyEvent) => void): () => void {
    const subscription = DeviceEventEmitter.addListener('steeringWheelMediaKey', callback);
    return () => subscription.remove();
}

/**
 * 监听全屏通知状态变化
 * @returns 取消监听函数
 */
export function onFullscreenStateChange(callback: (event: FullscreenStateEvent) => void): () => void {
    const subscription = DeviceEventEmitter.addListener('fullscreenStateChanged', callback);
    return () => subscription.remove();
}

/**
 * 监听屏幕状态变化（息屏/亮屏）
 * @returns 取消监听函数
 */
export function onScreenStateChange(callback: (event: ScreenStateEvent) => void): () => void {
    const subscription = DeviceEventEmitter.addListener('screenStateChanged', callback);
    return () => subscription.remove();
}
