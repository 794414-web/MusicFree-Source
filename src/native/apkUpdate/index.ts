import { NativeModule, NativeModules, Platform, DeviceEventEmitter } from 'react-native';

/**
 * APK 更新模块 TypeScript 接口
 *
 * 桥接 android/app/src/main/java/fun/upup/musicfree/update/ApkUpdateModule.kt
 * 功能：下载 APK 并自动弹出安装界面
 */

interface IApkUpdateModule extends NativeModule {
    /** 下载 APK 并自动安装，返回 downloadId */
    downloadAndInstall: (url: string) => Promise<number>;
    /** 获取下载进度 0-100，-1 表示无下载 */
    getDownloadProgress: () => Promise<number>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

const ApkUpdateNative: IApkUpdateModule | undefined = NativeModules.ApkUpdate;

function isApkUpdateSupported(): boolean {
    return Platform.OS === 'android' && !!ApkUpdateNative;
}

export const ApkUpdateModule = {
    isSupported: isApkUpdateSupported,

    downloadAndInstall: (url: string): Promise<number> => {
        if (!ApkUpdateNative) return Promise.resolve(-1);
        return ApkUpdateNative.downloadAndInstall(url).catch(() => -1);
    },

    getDownloadProgress: (): Promise<number> => {
        if (!ApkUpdateNative) return Promise.resolve(-1);
        return ApkUpdateNative.getDownloadProgress().catch(() => -1);
    },
};

/** 监听 APK 更新事件（installing / error） */
export function onApkUpdateEvent(
    callback: (event: { type: string; message: string }) => void,
): () => void {
    const subscription = DeviceEventEmitter.addListener('apkUpdateProgress', callback);
    return () => subscription.remove();
}
