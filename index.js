/**
 * @format
 */

import {AppRegistry, LogBox} from 'react-native';
import {name as appName} from './app.json';
import TrackPlayer from 'react-native-track-player';
import Pages from '@/entry';

// 禁用所有警告提示（包括底部黄色警告条 "Open debugger to view warnings"）
LogBox.ignoreAllLogs(true);

AppRegistry.registerComponent(appName, () => Pages);
TrackPlayer.registerPlaybackService(() => require('./src/service/index'));
