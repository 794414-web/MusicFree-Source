/**
 * MusicFree 车载系统适配模块
 * 提供车载特定功能的 JavaScript 接口
 *
 * 注意：原生 NativeModules.CarStatus / CarAudio 当前未注册，
 * 所有方法在非车载环境下安全降级，避免 undefined 调用导致崩溃。
 */

import { NativeModules, Platform, DeviceEventEmitter, EmitterSubscription } from 'react-native';

const { CarStatus, CarAudio } = NativeModules;

// 车载状态模块
export const CarStatusModule = {
  // 获取车速
  getCarSpeed: async (): Promise<number> => {
    if (Platform.OS !== 'android' || !CarStatus) {
      return 0;
    }
    try {
      return await CarStatus.getCarSpeed();
    } catch (error) {
      console.warn('获取车速失败:', error);
      return 0;
    }
  },

  // 获取挡位信息
  getGearPosition: async (): Promise<number> => {
    if (Platform.OS !== 'android' || !CarStatus) {
      return -1;
    }
    try {
      return await CarStatus.getGearPosition();
    } catch (error) {
      console.warn('获取挡位失败:', error);
      return -1;
    }
  },

  // 检查手刹状态
  isParkingBrakeOn: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarStatus) {
      return false;
    }
    try {
      return await CarStatus.isParkingBrakeOn();
    } catch (error) {
      console.warn('获取手刹状态失败:', error);
      return false;
    }
  },

  // 获取充电状态
  getChargingState: async (): Promise<number> => {
    if (Platform.OS !== 'android' || !CarStatus) {
      return -1;
    }
    try {
      return await CarStatus.getChargingState();
    } catch (error) {
      console.warn('获取充电状态失败:', error);
      return -1;
    }
  },

  // 获取电池电量
  getBatteryLevel: async (): Promise<number> => {
    if (Platform.OS !== 'android' || !CarStatus) {
      return -1;
    }
    try {
      return await CarStatus.getBatteryLevel();
    } catch (error) {
      console.warn('获取电池电量失败:', error);
      return -1;
    }
  },

  // 检查是否为车载模式
  isCarMode: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarStatus) {
      return false;
    }
    try {
      return await CarStatus.isCarMode();
    } catch (error) {
      console.warn('检查车载模式失败:', error);
      return false;
    }
  },

  // 获取车辆信息
  getCarInfo: async (): Promise<{
    manufacturer: string;
    model: string;
    brand: string;
    sdkInt: number;
    release: string;
  }> => {
    const fallback = {
      manufacturer: 'unknown',
      model: 'unknown',
      brand: 'unknown',
      sdkInt: 0,
      release: 'unknown',
    };
    if (Platform.OS !== 'android' || !CarStatus) {
      return fallback;
    }
    try {
      return await CarStatus.getCarInfo();
    } catch (error) {
      console.warn('获取车辆信息失败:', error);
      return fallback;
    }
  },
};

// 车载音频模块
export const CarAudioModule = {
  // 请求音频焦点
  requestAudioFocus: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return true;
    }
    try {
      return await CarAudio.requestAudioFocus();
    } catch (error) {
      console.warn('请求音频焦点失败:', error);
      return false;
    }
  },

  // 放弃音频焦点
  abandonAudioFocus: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return true;
    }
    try {
      return await CarAudio.abandonAudioFocus();
    } catch (error) {
      console.warn('放弃音频焦点失败:', error);
      return false;
    }
  },

  // 获取音量
  getVolume: async (): Promise<{ current: number; max: number; percent: number }> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return { current: 0, max: 1, percent: 0 };
    }
    try {
      return await CarAudio.getVolume();
    } catch (error) {
      console.warn('获取音量失败:', error);
      return { current: 0, max: 1, percent: 0 };
    }
  },

  // 设置音量
  setVolume: async (level: number): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return false;
    }
    try {
      return await CarAudio.setVolume(level);
    } catch (error) {
      console.warn('设置音量失败:', error);
      return false;
    }
  },

  // 检查是否静音
  isMuted: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return false;
    }
    try {
      return await CarAudio.isMuted();
    } catch (error) {
      console.warn('检查静音状态失败:', error);
      return false;
    }
  },

  // 设置静音
  setMuted: async (muted: boolean): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return false;
    }
    try {
      return await CarAudio.setMuted(muted);
    } catch (error) {
      console.warn('设置静音失败:', error);
      return false;
    }
  },

  // 调整音量
  adjustVolume: async (direction: 'up' | 'down'): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return false;
    }
    try {
      return await CarAudio.adjustVolume(direction);
    } catch (error) {
      console.warn('调整音量失败:', error);
      return false;
    }
  },

  // 检查蓝牙 SCO 状态
  isBluetoothScoOn: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return false;
    }
    try {
      return await CarAudio.isBluetoothScoOn();
    } catch (error) {
      console.warn('检查蓝牙 SCO 失败:', error);
      return false;
    }
  },

  // 设置蓝牙 SCO
  setBluetoothScoOn: async (on: boolean): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CarAudio) {
      return false;
    }
    try {
      return await CarAudio.setBluetoothScoOn(on);
    } catch (error) {
      console.warn('设置蓝牙 SCO 失败:', error);
      return false;
    }
  },
};

// 事件监听
export const CarEvents = {
  // 媒体按钮事件
  onMediaButton: (callback: (action: string) => void): EmitterSubscription => {
    return DeviceEventEmitter.addListener('com.musicfree.car.MEDIA_ACTION', (event) => {
      callback(event.action);
    });
  },

  // 音频焦点变化事件
  onAudioFocusChanged: (callback: (focusChange: number) => void): EmitterSubscription => {
    return DeviceEventEmitter.addListener('com.musicfree.car.AUDIO_FOCUS_CHANGED', (event) => {
      callback(event.focusChange);
    });
  },

  // 车载状态变化事件
  onCarStateChanged: (callback: (type: string, value: any) => void): EmitterSubscription => {
    return DeviceEventEmitter.addListener('com.musicfree.car.CAR_STATE_CHANGED', (event) => {
      callback(event.type, event.value);
    });
  },

  // 网络状态变化事件
  onNetworkChanged: (callback: (connected: boolean, type: string) => void): EmitterSubscription => {
    return DeviceEventEmitter.addListener('com.musicfree.car.NETWORK_CHANGED', (event) => {
      callback(event.connected, event.type);
    });
  },
};

// 驾驶状态常量
export const DrivingState = {
  UNKNOWN: 0,
  MOVING: 1,
  IDLE: 2,
  PARKED: 3,
};

// 挡位常量
export const GearPosition = {
  UNKNOWN: -1,
  PARK: 0,
  REVERSE: 1,
  NEUTRAL: 2,
  DRIVE: 3,
};

export default {
  status: CarStatusModule,
  audio: CarAudioModule,
  events: CarEvents,
  DrivingState,
  GearPosition,
};
