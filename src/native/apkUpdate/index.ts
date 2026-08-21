import { NativeModule, NativeModules, Platform, DeviceEventEmitter } from 'react-native';

/**
 * APK 更新模块 TypeScript 接口
 *
 * 桥接 android/app/src/main/java/fun/upup/musicfree/update/ApkUpdateModule.kt
 * 功能：下载 APK 并自动弹出安装界面
 */

interface IApkUpdateModule extends NativeModule {
    checkUpdate: (currentVersion: string) => Promise<{
        needUpdate: boolean;
        version?: string;
        changeLog?: string[];
        download?: string[];
    }>;
    downloadAndInstall: (url: string) => Promise<number>;
    getDownloadProgress: () => Promise<{
        progress: number;
        speed: number;
        downloadedBytes: number;
        totalBytes: number;
    }>;
    getLastError: () => Promise<string>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
}

export interface IDownloadProgress {
    progress: number;
    speed: number;
    downloadedBytes: number;
    totalBytes: number;
}

const ApkUpdateNative: IApkUpdateModule | undefined = NativeModules.ApkUpdate;

function isApkUpdateSupported(): boolean {
    return Platform.OS === 'android' && !!ApkUpdateNative;
}

export const ApkUpdateModule = {
    isSupported: isApkUpdateSupported,

    checkUpdate: (currentVersion: string) => {
        if (!ApkUpdateNative) return Promise.reject(new Error('原生模块未加载'));
        return ApkUpdateNative.checkUpdate(currentVersion).catch((e: any) => {
            const msg = e?.message || e?.toString?.() || '未知错误';
            throw new Error(msg);
        });
    },

    downloadAndInstall: (url: string): Promise<number> => {
        if (!ApkUpdateNative) return Promise.reject(new Error('原生模块未加载'));
        return ApkUpdateNative.downloadAndInstall(url).catch((e: any) => {
            const msg = e?.message || e?.toString?.() || '未知错误';
            throw new Error(msg);
        });
    },

    getDownloadProgress: (): Promise<IDownloadProgress> => {
        if (!ApkUpdateNative) {
            return Promise.resolve({ progress: -1, speed: 0, downloadedBytes: 0, totalBytes: 0 });
        }
        return ApkUpdateNative.getDownloadProgress().catch(() => ({
            progress: -1,
            speed: 0,
            downloadedBytes: 0,
            totalBytes: 0,
        }));
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
