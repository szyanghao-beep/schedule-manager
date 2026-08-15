# 日程管理 · 多端同步架构

从单机 Electron 应用升级为「电脑端 + 安卓手机端 + 自建后端」的多端同步系统。

## 目录结构

```
日程管理工具/
├── shared/      # ★ 共享包（单一来源）：纯函数 + 常量 + 同步算法 + 数据模型
│   ├── utils.js       # 日期/重复展开/四象限/统计/搜索（UMD，浏览器+Node 通用）
│   ├── constants.js   # 状态/优先级/重复/分类/四象限常量
│   ├── migrate.js     # 数据 schema 版本迁移
│   ├── sync.js        # 同步纯函数：LWW 合并、软删除墓碑、增量提取、extractLocalChanges
│   ├── model.js       # 数据模型契约 + change 校验
│   └── index.js       # 统一导出
├── server/      # Node 后端（Express + node:sqlite + JWT），认证 + 增量同步 + 服务端仲裁
├── mobile/      # React Native 安卓端（复用 shared，登录 + 同步 + 日程/待办 MVP）
├── main.js      # 桌面端主进程（含同步 IPC 与拉推合并逻辑）
├── preload.js   # 桌面端安全桥（含同步 API）
└── src/         # 桌面端渲染层（store 已改造为软删除 + 记录级 updatedAt）
```

## 快速开始

### 1. 启动后端（电脑或常在线设备）

```bash
cd server
npm install
SECRET="改成随机字符串" npm start     # 监听 0.0.0.0:8787
```

### 2. 电脑端（桌面应用）

```bash
npm install
npm start
```

进入「设置 → 多端同步」，填服务器地址（如 `http://<电脑IP>:8787`）+ 用户名/密码，点「注册并登录」，再点「立即同步」。

### 3. 安卓端

```bash
cd mobile
npm install
# 首次需生成原生工程（见 mobile/README.md）：
#   npx @react-native-community/cli@latest init ScheduleMobile --version 0.74.5
# 并把生成内容并入 mobile/，然后：
npm run android
```

## 同步机制（核心设计）

1. **记录级增量**：每条记录带 `id / entityType / deleted / updatedAt`，不再整文件覆盖。
2. **软删除墓碑**：删除只置 `deleted=true`，防止已删记录复活；`store.get()` 返回过滤后的存活视图，`getRaw()` 返回含墓碑的完整数据。
3. **本地修改追踪**：本地增删改同时写 `updatedAt` 和 `localModifiedAt`；推送只用 `localModifiedAt`（客户端时间轴），远程拉回的记录无 `localModifiedAt`、不会被回推——彻底解决设备时钟偏差。
4. **服务端时间仲裁 + LWW**：服务端给每条 change 盖递增时间戳，`lww` 取新者胜、相等时墓碑优先。
5. **增量游标**：拉取 `since=lastPulledAt`（服务端时间轴），推送 `since=lastPushedAt`（客户端时间轴），两者独立。

## 测试

```bash
npm test            # 桌面端 + shared 全量（含 sync.test.js 12 个同步用例）
cd server && node verify-server.js   # 后端 14 项集成测试
```

## 已知限制

- LWW 对「两台设备同时改同一条且都未先拉取」的并发，按服务端到达顺序仲裁（MVP 简化）。
- `settings`（本地偏好）不同步。
- 后端未内置 HTTPS，生产置于反向代理之后。
- 安卓端重复日程的「仅本次」编辑退化为整系列（见 mobile/README.md）。
