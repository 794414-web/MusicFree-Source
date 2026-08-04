import { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter, EmitterSubscription, PixelRatio, Platform } from 'react-native';
import { useAppConfig } from '@/core/appConfig';
import TrackPlayer, { useCurrentMusic, useMusicState } from '@/core/trackPlayer';
import { musicIsPaused } from '@/utils/trackUtils';
import { useCurrentLyricItem } from '@/core/lyricManager';
import Toast from '@/utils/toast';
import { FloatingWindowModule } from '@/native/floatingWindow';

/**
 * 将 dp 转为 px（原生模块接收 px）
 */
function dpToPx(dp: number): number {
  return Math.round(PixelRatio.getPixelSizeForLayoutSize(dp));
}

/**
 * 悬浮窗管理 Hook
 *
 * - 当 effectiveEnabled 为 true 时显示悬浮窗，false 时隐藏
 * - 监听当前歌曲、播放状态、当前歌词，实时同步给原生悬浮窗
 * - 监听原生悬浮窗按钮事件，转发到 TrackPlayer
 * - 应用从前台回到后台时悬浮窗仍然显示（系统级窗口）
 *
 * 仅 Android 平台生效；其他平台为 no-op。
 */
export function useFloatingWindow(effectiveEnabled: boolean) {
  const width = useAppConfig('basic.floatingWindowWidth');
  const height = useAppConfig('basic.floatingWindowHeight');
  const fontSize = useAppConfig('basic.floatingWindowFontSize');
  const bgColor = useAppConfig('basic.floatingWindowBgColor');
  const textColor = useAppConfig('basic.floatingWindowTextColor');
  const showCover = useAppConfig('basic.floatingWindowShowCover');

  const currentMusic = useCurrentMusic();
  const musicState = useMusicState();
  const currentLyric = useCurrentLyricItem();

  const enabled = effectiveEnabled;

  // 记录是否已经显示过，避免重复调用 show
  const shownRef = useRef(false);
  // 记录事件订阅
  const subscriptionRef = useRef<EmitterSubscription | null>(null);
  // 跟踪最新播放状态，避免在事件回调里查询原生播放器
  const musicStateRef = useRef(musicState);
  useEffect(() => {
    musicStateRef.current = musicState;
  }, [musicState]);

  // 监听原生按钮事件
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    if (!enabled) {
      return;
    }
    subscriptionRef.current = DeviceEventEmitter.addListener(
      'FloatingWindowAction',
      (action: string) => {
        switch (action) {
          case 'prev':
            TrackPlayer.skipToPrevious();
            break;
          case 'next':
            TrackPlayer.skipToNext();
            break;
          case 'toggle':
            if (musicIsPaused(musicStateRef.current)) {
              TrackPlayer.play();
            } else {
              TrackPlayer.pause();
            }
            break;
          default:
            break;
        }
      },
    );
    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [enabled]);

  // 开关悬浮窗
  const showFloatingWindow = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }
    const supported = FloatingWindowModule.isSupported();
    if (!supported) {
      Toast.warn('当前设备不支持悬浮窗');
      return;
    }
    const hasPermission = await FloatingWindowModule.checkPermission();
    if (!hasPermission) {
      Toast.warn('请先授予悬浮窗权限');
      try {
        await FloatingWindowModule.requestPermission();
      } catch {}
      return;
    }
    // 显示悬浮窗（width/height 配置以 dp 存储，转为 px 传给原生）
    const widthPx = width ? dpToPx(width) : 0;
    const heightPx = height ? dpToPx(height) : 0;
    await FloatingWindowModule.show(widthPx, heightPx);
    shownRef.current = true;

    // 初始化主题
    if (bgColor || textColor) {
      await FloatingWindowModule.setThemeColors(bgColor ?? null, textColor ?? null);
    }
    if (fontSize) {
      await FloatingWindowModule.setFontSize(fontSize);
    }
    // 初始化封面显示
    await FloatingWindowModule.setCoverVisible(!!showCover);
    if (showCover && currentMusic?.artwork) {
      await FloatingWindowModule.setCover(currentMusic.artwork);
    }
  }, [width, height, bgColor, textColor, fontSize, showCover, currentMusic]);

  const hideFloatingWindow = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }
    await FloatingWindowModule.hide();
    shownRef.current = false;
  }, []);

  // 监听 enabled 变化
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    if (enabled) {
      showFloatingWindow();
    } else if (shownRef.current) {
      hideFloatingWindow();
    }
    // 应用被关闭时也确保隐藏
    return () => {
      if (shownRef.current) {
        FloatingWindowModule.hide();
        shownRef.current = false;
      }
    };
  }, [enabled, showFloatingWindow, hideFloatingWindow]);

  // 同步播放状态
  useEffect(() => {
    if (!enabled || !shownRef.current) {
      return;
    }
    const isPaused = musicIsPaused(musicState);
    FloatingWindowModule.setIsPlaying(!isPaused);
  }, [enabled, musicState]);

  // 同步当前歌词
  useEffect(() => {
    if (!enabled || !shownRef.current) {
      return;
    }
    const lyricText = currentLyric?.lrc
      ? currentLyric.lrc + (currentLyric.translation ? `\n${currentLyric.translation}` : '')
      : currentMusic
        ? `${currentMusic.title ?? ''} - ${currentMusic.artist ?? ''}`
        : 'MusicFree';
    FloatingWindowModule.setLyric(lyricText);
  }, [enabled, currentLyric, currentMusic]);

  // 同步封面
  useEffect(() => {
    if (!enabled || !shownRef.current) {
      return;
    }
    FloatingWindowModule.setCoverVisible(!!showCover);
    if (showCover && currentMusic?.artwork) {
      FloatingWindowModule.setCover(currentMusic.artwork);
    } else if (!showCover) {
      FloatingWindowModule.setCover(null);
    }
  }, [enabled, showCover, currentMusic]);

  // 同步大小
  useEffect(() => {
    if (!enabled || !shownRef.current) {
      return;
    }
    if (width !== undefined || height !== undefined) {
      const widthPx = width ? dpToPx(width) : 0;
      const heightPx = height ? dpToPx(height) : 0;
      FloatingWindowModule.setSize(widthPx, heightPx);
    }
  }, [enabled, width, height]);

  // 同步字号
  useEffect(() => {
    if (!enabled || !shownRef.current) {
      return;
    }
    if (fontSize !== undefined) {
      FloatingWindowModule.setFontSize(fontSize);
    }
  }, [enabled, fontSize]);

  // 同步颜色
  useEffect(() => {
    if (!enabled || !shownRef.current) {
      return;
    }
    FloatingWindowModule.setThemeColors(bgColor ?? null, textColor ?? null);
  }, [enabled, bgColor, textColor]);

  return {
    showFloatingWindow,
    hideFloatingWindow,
  };
}

export default useFloatingWindow;

/**
 * 全局悬浮窗控制器（非 Hook 场景下使用，例如设置页面直接调用）
 */
export const FloatingWindowController = {
  async show() {
    if (Platform.OS !== 'android') {
      return;
    }
    await FloatingWindowModule.show(0, 0);
  },
  async hide() {
    if (Platform.OS !== 'android') {
      return;
    }
    await FloatingWindowModule.hide();
  },
  async checkPermission() {
    if (Platform.OS !== 'android') {
      return false;
    }
    return FloatingWindowModule.checkPermission();
  },
  async requestPermission() {
    if (Platform.OS !== 'android') {
      return;
    }
    return FloatingWindowModule.requestPermission();
  },
};
