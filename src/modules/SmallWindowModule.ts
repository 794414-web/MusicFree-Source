/**
 * MusicFree 车载系统 - 小窗口模式模块
 * 已禁用小窗口功能
 */

/**
 * 小窗口模式管理
 */
export const SmallWindowModule = {
  /**
   * 检查是否支持小窗口模式
   */
  isSupported: async (): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 检查当前是否为小窗口模式
   */
  isInSmallWindow: async (): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 进入小窗口模式
   */
  enterSmallWindow: async (): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 退出小窗口模式
   */
  exitSmallWindow: async (): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 切换小窗口模式
   */
  toggleSmallWindow: async (): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 设置小窗口尺寸
   */
  setSmallWindowSize: async (width: number, height: number): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 设置小窗口位置
   */
  setSmallWindowPosition: async (x: number, y: number): Promise<boolean> => {
    return false; // 小窗口模式已禁用
  },

  /**
   * 获取推荐的小窗口尺寸
   */
  getRecommendedSize: (): { width: number; height: number } => {
    return {
      width: 480,
      height: 320,
    };
  },

  /**
   * 获取推荐的小窗口位置
   */
  getRecommendedPosition: (screenWidth: number, screenHeight: number): { x: number; y: number } => {
    const size = SmallWindowModule.getRecommendedSize();
    return {
      x: 40,
      y: screenHeight - size.height - 40,
    };
  },
};

/**
 * 小窗口事件监听
 */
export const SmallWindowEvents = {
  /**
   * 监听小窗口状态变化
   */
  onSmallWindowChanged: (callback: (isInSmallWindow: boolean) => void) => {
    // 小窗口模式已禁用，返回空监听器
    return {
      remove: () => {}
    };
  },

  /**
   * 监听小窗口尺寸变化
   */
  onSmallWindowSizeChanged: (callback: (width: number, height: number) => void) => {
    // 小窗口模式已禁用，返回空监听器
    return {
      remove: () => {}
    };
  },

  /**
   * 监听小窗口位置变化
   */
  onSmallWindowPositionChanged: (callback: (x: number, y: number) => void) => {
    // 小窗口模式已禁用，返回空监听器
    return {
      remove: () => {}
    };
  },
};

/**
 * 小窗口模式常量
 */
export const SmallWindowMode = {
  // 不支持
  UNSUPPORTED: 0,
  // 支持但未启用
  SUPPORTED: 1,
  // 小窗口模式
  SMALL_WINDOW: 2,
  // 全屏模式
  FULL_SCREEN: 3,
};

export default {
  module: SmallWindowModule,
  events: SmallWindowEvents,
  SmallWindowMode,
};