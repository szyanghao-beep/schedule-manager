# 日程管理 · React Native 安卓端（mobile）

与桌面端共用 `../shared` 共享包（常量 / 纯函数 / 同步逻辑 / 数据模型），通过后端
`http://<电脑局域网IP>:8787` 做记录级增量同步（LWW + 服务端时间仲裁）。

---

## 一、功能范围（MVP）

- 登录 / 注册（可配置服务器地址）
- 主界面底部 Tab：日程 / 待办 / 我的
- 日程页：按日期列表（用 `shared/utils.expandOccurrences` 展开重复日程）+ 新增/编辑/删除
- 待办页：列表 + 完成勾选 + 四象限彩色徽标（`calcQuadrant`）+ 新增/编辑/删除
- 同步：登录后首次全量拉取；每次增删改自动推送（防抖 800ms）；「我的」页手动「立即同步」；
  本地用 AsyncStorage 持久化 `{token, serverUrl, user, lastSyncAt, journal, records}`
- 提醒：仅保存 `remindBefore` 字段（界面占位），未接本地通知（MVP 不强求）

---

## 二、目录结构

```
mobile/
├── package.json          # 依赖与脚本（npm run android / start）
├── index.js              # AppRegistry 入口（appName 与 android/ 原生工程一致）
├── App.js                # 入口导航：登录 ↔ 主界面(Tab) + 表单 modal；启动加载与自动同步
├── metro.config.js       # watchFolders 指向 ../shared（复用共享包的关键）
├── babel.config.js       # RN 官方 babel preset
├── app.json              # name=ScheduleMobile, displayName=日程管理
└── src/
    ├── shared.js         # 共享包唯一引用点（默认 require('../../shared/index.js')）
    ├── api.js            # 后端 REST 客户端（fetch，登录/注册/拉取/推送）
    ├── store.js          # 本地数据层：记录 Map + journal + AsyncStorage 持久化
    ├── syncClient.js     # 同步编排：推/拉/合并（复用 shared/sync）+ 状态订阅
    ├── formats.js        # 日期时间文本输入/展示辅助
    ├── screens/
    │   ├── LoginScreen.js   # 登录/注册（可填服务器地址）
    │   ├── EventsScreen.js  # 日程页（按日期 + 重复展开）
    │   ├── TodosScreen.js   # 待办页（四象限徽标 + 完成勾选）
    │   └── ProfileScreen.js # 我的（同步状态、立即同步、退出登录）
    └── components/
        ├── EventForm.js     # 日程新增/编辑表单
        ├── TodoForm.js      # 待办新增/编辑表单
        ├── ChipGroup.js     # 单选标签组
        ├── CategoryPicker.js# 分类选择（色块）
        └── QuadrantBadge.js # 四象限彩色徽标
```

---

## 三、环境要求

- Node.js >= 18
- JDK 17（Android 构建需要）
- Android Studio + Android SDK（compileSdk 34）
- 一台运行服务端的电脑（地址 `http://<电脑局域网IP>:8787`，由他人实现）
- 安卓手机（与电脑同一局域网）或安卓模拟器（AVD）

---

## 四、安装运行步骤

### 1. 原生 android/ 工程（已随仓库提交，无需再生成）

`mobile/android/` 完整的 Gradle 原生工程**已随仓库提交**（含 `debug.keystore`），
app 名统一为「日程管理」，`AndroidManifest.xml` 已加 `usesCleartextTraffic="true"`。
无需再 `init` 生成，直接安装依赖后即可构建。

### 2. 安装依赖

```bat
cd E:\DSH\日程管理工具\mobile
npm install
```

### 3. 构建 / 安装 APK

**方式 A：CI 自动构建（推荐，无需本地 Android 环境）**

仓库的 `.github/workflows/build-apk.yml` 会在 mobile/ 或 shared/ 变更时自动构建
**release APK**（JS bundle 已打包，装手机即可独立运行，无需 Metro）：
Actions → `build-apk` → 下载 artifact `日程管理-安卓端-release` → 解压得 `app-release.apk`。

**方式 B：本地构建（需 Android SDK + JDK 17）**

```bat
cd E:\DSH\日程管理工具\mobile\android
gradlew assembleRelease
:: 产物在 app/build/outputs/apk/release/app-release.apk
```

### 4. 配置服务器地址

在 App 登录页填写服务器地址：

- **真机**：`http://<电脑局域网IP>:8787`（手机与电脑同一 Wi-Fi；Windows 防火墙需放行 8787 端口）
- **安卓模拟器**：`http://10.0.2.2:8787`（模拟器访问宿主机的专用地址）
- **USB 调试**：`adb reverse tcp:8787 tcp:8787` 后可用 `http://127.0.0.1:8787`

### 4. 允许明文 HTTP（开发期必须，否则请求会报 CLEARTEXT 错误）

Android 9+ 默认禁止 http 明文。编辑 `mobile/android/app/src/main/AndroidManifest.xml`，
在 `<application ...>` 标签上增加：

```xml
android:usesCleartextTraffic="true"
```

> 仅开发期使用；生产环境应改用 https。

### 5. 运行

```bat
cd E:\DSH\日程管理工具\mobile
npm run android
```

`npm run android` 会自动启动 Metro 并安装运行到已连接的设备/模拟器。
如需分开启动：先 `npm start`（Metro），再开另一个终端 `npm run android`。
若 shared 目录改动后 Metro 未感知，可用 `npm run start:reset` 清缓存重启。

---

## 五、依赖清单

| 包 | 版本 | 用途 |
| --- | --- | --- |
| react / react-native | 18.2.0 / 0.74.5 | RN 运行时 |
| @react-navigation/native | ^6.1.18 | 导航基础 |
| @react-navigation/native-stack | ^6.11.0 | 根导航 + 表单 modal |
| @react-navigation/bottom-tabs | ^6.6.1 | 底部 Tab |
| react-native-screens | ~3.31.1 | native-stack/bottom-tabs 依赖 |
| react-native-safe-area-context | ^4.10.5 | 安全区 |
| @react-native-async-storage/async-storage | ^1.24.0 | 本地持久化 |
| @react-native/metro-config / @react-native/babel-preset / @babel/core | ^0.74.5 / ^0.74.5 / ^7.24 | 构建（dev） |

> 日期时间采用「文本输入 + 校验」实现（YYYY-MM-DD / HH:mm），未引入
> `@react-native-community/datetimepicker`，如需原生日期选择器可自行接入。

---

## 六、与 shared 共享包的复用说明

### 方案 A（默认，单一来源）：Metro watchFolders

`metro.config.js` 把项目外的 `../shared` 加入打包监视范围：

```js
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const config = {
  watchFolders: [path.resolve(__dirname, '../shared')],
  resolver: { nodeModulesPaths: [path.resolve(__dirname, 'node_modules')] },
};
module.exports = mergeConfig(getDefaultConfig(__dirname), config);
```

- 代码统一通过 `src/shared.js` 引用：`module.exports = require('../../shared/index.js')`，
  即 `E:\DSH\日程管理工具\shared\index.js`（其中 `constants/utils/sync/model/migrate`
  均被 Metro 一并打包）。
- 共享包是**唯一数据源**，桌面端与手机端改动共享代码后两端同时生效，不复制、不漂移。

### 方案 B（退化）：复制进 src/shared

若 watchFolders 方案在目标 RN 版本出现兼容问题，退化为复制：

```bat
cd E:\DSH\日程管理工具\mobile
xcopy /E /I /Y ..\shared src\shared
```

然后把 `src/shared.js` 里那一行改为：

```js
module.exports = require('./shared/index.js');
```

其余代码无需任何改动（全项目只有 `src/shared.js` 依赖 shared 的路径）。
注意：复制方案下 shared 的修改需要手动重新复制，建议写进构建脚本或 README 提醒。

---

## 七、同步机制说明

- **记录级增量 + LWW + 服务端时间仲裁**：每条记录带 `{id, entityType, deleted, updatedAt, data}`；
  冲突时 `updatedAt` 新者胜，相等时墓碑（deleted）优先；服务端合并前会把
  `updatedAt` 重写为服务器时间。
- **本地变更（journal）**：每次增删改生成一条 change 进 journal（同 key 旧条目自动作废），
  合并进本地 Map 并持久化；随后自动防抖推送（800ms）。
- **推送**：POST `/api/sync` 发送 journal；成功后 `updatedAt <= serverTime` 的条目出队，
  并把对应本地记录时间采纳为服务器时间（缓解本地时钟偏差对 LWW 的影响）。
- **拉取**：GET `/api/sync?since=lastSyncAt`，返回 changes 用 `sync.mergeChanges` 合并；
  仅拉取成功后推进 `lastSyncAt`（避免漏掉服务端其他设备的变更）。登录后首次 `since=0` 即全量。
- **离线**：变更留在 journal，网络恢复后手动「立即同步」或下次启动自动同步即可补推；
  重复推送是幂等的（LWW）。

---

## 八、已知限制

- 重复日程「单次编辑」= 编辑整个系列；删除支持「仅删除本次」（写入
  `exceptions[occurrenceKey]=true`，被 `expandOccurrences` 跳过）。
- 未接入本地通知（@notifee/react-native 等），`remindBefore` 仅作字段保存。
- 分类 / 设置（settings）只在电脑端维护，手机端只读使用（列表/象限阈值会自动跟随同步结果）。
- 仅支持 Android。
- LWW 对设备时钟偏差敏感：服务端时间仲裁可缓解，但本地时钟严重超前时可能反复推送同一变更
  （幂等无害，时钟校准后自愈）。
- 日期时间用文本输入，未做原生选择器与跨时区处理（与桌面端同为本地时区口径）。
