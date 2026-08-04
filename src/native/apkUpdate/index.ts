import { NativeModule, NativeModules, Platform, DeviceEventEmitter } from 'react-native';

/**
 * APK 更新模块 TypeScript 接口
 *
 * 桥接 android/app/src/main/java/fun/upup/musicfree/update/ApkUpdateModule.kt
 * 功能：下载 APK 并自动弹出安装界面
 */

interface IApkUpdateModule extends NativeModule {
    /** 下载 APK 并自动安装，返回 downloadId；失败时抛出错误 */
    downloadAndInstall: (url: string) => Promise<number>;
    /** 获取下载进度 0-100，-1 表示无下载 */
    getDownloadProgress: () => Promise<number>;
    /** 获取最近的错误信息 */
    getLastError: () => Promise<string>;
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
        if (!ApkUpdateNative) return Promise.reject(new Error('原生模块未加载'));
        return ApkUpdateNative.downloadAndInstall(url).catch((e: any) => {
            const msg = e?.message || e?.toString?.() || '未知错误';
            throw new Error(msg);
        });
    },

    getDownloadProgress: (): Promise<number> => {
        if (!ApkUpdateNative) return Promise.resolve(-1);
        return ApkUpdateNative.getDownloadProgress().catch(() => -1);
    },

    getLastError: (): Promise<string> => {
        if (!ApkUpdateNative) return Promise.resolve('原生模块未加载');
        return ApkUpdateNative.getLastError().catch(() => '未知错误');
    },
};

/** 监听 APK 更新事件（installing / error） */
export function onApkUpdateEvent(
    callback: (event: { type: string; message: string }) => void,
): () => void {
    const subscription = DeviceEventEmitter.addListener('apkUpdateProgress', callback);
    return () => subscription.remove();
}
