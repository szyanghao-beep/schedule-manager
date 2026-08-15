/**
 * index.js — RN 应用注册入口。
 * app.json 的 name 必须与原生工程 MainActivity 的 getMainComponentName 一致
 * （本项目约定为 ScheduleMobile，生成 android/ 时项目名请用 ScheduleMobile）。
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
