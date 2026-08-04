import { NativeModule, NativeModules, Platform } from 'react-native';

/**
 * 悬浮窗原生模块 TypeScript 接口
 *
 * 桥接 android/app/src/main/java/fun/upup/musicfree/floatingWindow/FloatingWindowModule.kt
 */
export interface IFloatingWindowModule extends NativeModule {
  /** 检查是否拥有悬浮窗权限 */
  checkPermission: () => Promise<boolean>;
  /** 请求悬浮窗权限（跳转到系统设置） */
  requestPermission: () => Promise<boolean>;
  /** 显示悬浮窗，传入初始宽高（px），0 表示使用默认值 */
  show: (initialWidth: number, initialHeight: number) => Promise<boolean>;
  /** 隐藏悬浮窗 */
  hide: () => Promise<boolean>;
  /** 更新悬浮窗歌词文本 */
  setLyric: (text: string) => Promise<boolean>;
  /** 更新播放状态：true=播放中显示暂停图标，false=暂停显示播放图标 */
  setIsPlaying: (playing: boolean) => Promise<boolean>;
  /** 设置悬浮窗大小（px），height=0 表示自适应 */
  setSize: (width: number, height: number) => Promise<boolean>;
  /** 设置歌词字号（sp） */
  setFontSize: (sp: number) => Promise<boolean>;
  /** 设置悬浮窗背景色与文字颜色（hex 或 rgba） */
  setThemeColors: (
    backgroundColor: string | null,
    textColor: string | null,
  ) => Promise<boolean>;
  /** 设置封面图片（URL 或本地路径），传 null/空字符串隐藏封面 */
  setCover: (url: string | null) => Promise<boolean>;
  /** 设置封面是否可见 */
  setCoverVisible: (visible: boolean) => Promise<boolean>;
  /** RN 事件发射器需要的占位方法 */
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
}

const FloatingWindow: IFloatingWindowModule | undefined =
  NativeModules.FloatingWindow;

/**
 * 是否支持悬浮窗（仅 Android 且原生模块已注册）
 */
export function isFloatingWindowSupported(): boolean {
  return Platform.OS === 'android' && !!FloatingWindow;
}

/**
 * 安全调用：若模块未注册，返回 false，避免崩溃
 */
function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!FloatingWindow) {
    return Promise.resolve(fallback);
  }
  try {
    return fn().catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

export const FloatingWindowModule = {
  isSupported: isFloatingWindowSupported,

  checkPermission: (): Promise<boolean> =>
    safeCall(() => FloatingWindow!.checkPermission(), false),

  requestPermission: (): Promise<boolean> =>
    safeCall(() => FloatingWindow!.requestPermission(), false),

  show: (initialWidth = 0, initialHeight = 0): Promise<boolean> =>
    safeCall(() => FloatingWindow!.show(initialWidth, initialHeight), false),

  hide: (): Promise<boolean> => safeCall(() => FloatingWindow!.hide(), false),

  setLyric: (text: string): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setLyric(text), false),

  setIsPlaying: (playing: boolean): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setIsPlaying(playing), false),

  setSize: (width: number, height: number): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setSize(width, height), false),

  setFontSize: (sp: number): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setFontSize(sp), false),

  setThemeColors: (
    backgroundColor: string | null,
    textColor: string | null,
  ): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setThemeColors(backgroundColor, textColor), false),

  setCover: (url: string | null): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setCover(url), false),

  setCoverVisible: (visible: boolean): Promise<boolean> =>
    safeCall(() => FloatingWindow!.setCoverVisible(visible), false),
};

export default FloatingWindowModule;
