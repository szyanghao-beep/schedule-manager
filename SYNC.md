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
│   ├── inbox.js       # 收集条目规范化与合并（手机收集 → 电脑收件箱）
│   ├── model.js       # 数据模型契约 + change 校验
│   └── index.js       # 统一导出
├── server/      # Node 后端（Express + node:sqlite + JWT）：认证 + 增量同步 + 收集直传端点
├── mobile/      # React Native 安卓端（收集 / 日程 / 待办 / 我的）
├── main.js      # 桌面端主进程（内嵌同步服务器 + 同步 IPC + 收集接收）
├── preload.js   # 桌面端安全桥（含同步 API）
└── src/         # 桌面端渲染层（store 已改造为软删除 + 记录级 updatedAt）
```

## 快速开始

### 1. 启动后端（电脑或常在线设备）

```bash
cd server
npm install
npm start                 # 监听 0.0.0.0:8787；未设置 SECRET 时自动生成随机密钥（server/.secret）
# 生产建议显式注入：SECRET="$(openssl rand -hex 32)" npm start
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
4. **客户端编辑时间 LWW + 服务端时间戳游标**：服务端按客户端声明的 `updatedAt`（编辑时间）做 LWW 仲裁，新者胜、相等时墓碑（deleted）优先；另盖单调递增的 `updated_at` 仅作增量拉取游标。二者职责分离，避免「离线设备带旧数据晚到推送就覆盖新数据」。
5. **增量游标**：拉取 `since=lastPulledAt`（服务端时间轴），推送 `since=lastPushedAt`（客户端时间轴），两者独立。
6. **桌面端自动同步**：本地变更防抖 2s 自动推送，启动时自动拉取；同步状态（含加密 token）持久化到 `sync-state.json`，重启不丢配置。

## 局域网收集直传（免登录，手机 → 电脑收件箱）

与上面的「账号双向同步」并列的另一条轻量通道，专为「手机随手记 → 回家手动送进电脑收件箱」设计：

**手机端**：底部「收集」Tab（免登录可用）
- 极简输入框，记完一条自动清空，可连续录入多个想法
- 纯离线：只写本地（AsyncStorage），**不自动联网**
- 顶部显示「待同步 N 条」；底部「同步到电脑」按钮，首次填电脑地址 + 收集口令即可（之后记住）

**电脑端**：设置 →「本机同步服务」启用后自动支持
- 页面直接显示**局域网地址**（免去自己查 IP）与**收集口令**（6 位，由同步密钥 HMAC 派生、稳定不变）
- 接收端点 `POST /api/inbox-drop`：校验 `X-Pairing-Code` 头 → 按条目 id 去重（幂等）→ 并入收件箱

**为什么能直接进收件箱**：电脑端「收件箱」的定义是「未完成 + 无截止时间的待办」，而手机收集的条目正好规范化为 `deadline: null, status: 'pending'`（见 `shared/inbox.js`），语义天然吻合，无需额外状态字段。

**安全**：免登录但需配对码（防止同网陌生设备写入）；单次最多 500 条；非法条目忽略。

**数据流**：

```
手机收集（离线）→ 点「同步到电脑」→ POST /api/inbox-drop（带配对码）
   → 电脑端 mergeInboxItems 去重合并进 todos → 立刻出现在「收件箱」等待整理
```

## 测试

```bash
npm test            # 桌面端 + shared 全量（含 sync / inbox 等用例）
cd server && npm install
node verify-server.js       # 后端集成测试（认证 + 增量同步）
node verify-e2e.js          # 真实文件 DB + 重启持久化
node verify-inbox-drop.js   # 收集直传端点（配对码 / 幂等 / 收件箱语义）
```

## 已知限制

- LWW 对「两台设备同时改同一条」的并发按客户端编辑时间新者胜；客户端时钟严重漂移时仍可能误判（要因果正确需升级为版本向量 / CRDT）。
- `settings` 部分同步：仅 `urgentThresholdHours` / `defaultRemindBefore`；`theme` 等本地偏好仍各端独立。
- 后端依赖 Node 内置 `node:sqlite`，要求 Node ≥ 22.5（`server.js` 启动时会校验并提示）。
- 后端未内置 HTTPS，生产置于反向代理之后。
- 安卓端重复日程的「仅本次」编辑退化为整系列（见 mobile/README.md）。
