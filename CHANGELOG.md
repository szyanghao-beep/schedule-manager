# 日程管理工具 · 开发与操作日志

> 本文件记录该项目从创建到当前版本的完整开发过程、测试记录、打包发布与已知问题。

## 项目概览

| 项 | 值 |
|----|----|
| 产品名 | 日程管理（schedule-manager） |
| 技术栈 | Electron 43.4.0，纯原生 JS（无前端框架） |
| 结构 | 主进程 `main.js` + `preload.js`（项目根目录）；渲染层 `src/renderer/` |
| 数据持久化 | `userData/data.json`，防抖保存 500ms，自动备份（最多 10 份） |
| 仓库 | https://github.com/szyanghao-beep/schedule-manager.git（分支 `main`） |
| 当前版本 | **v2.1.0** |

---

## 版本历史

### v2.1.0（2026-08-22）— GTD + 时间块执行系统（方案 A）

在 v2.0.1 基础上落地「GTD + Time Blocking」时间块执行系统（方案 A），把待办从「清单」升级为「可排程的时间块」。

**核心能力**
- **预估耗时（estimatedMinutes）**：待办新增/编辑增加「预估耗时」字段（15/30/45/60/90/120/180/240 分钟），桌面端与安卓端表单同步支持；`validateTodo` 校验为 1~1440 整数分钟。
- **时间块排程（排到日程）**：待办右键 / 行内按钮 / 日程提醒项右键均可「排到日程」，按预估耗时生成时间块日程，并记录 `scheduledEventId` 关联（删除日程后自动解除关联，可再次排程）。
- **今日规划（自动排程）**：新增「今日规划」视图，`utils.autoSchedule` 纯函数按「截止时间 → 四象限 → 优先级」贪心把待办填入当天工作时段（默认 9:00–18:00、30 分钟槽位、5 分钟缓冲），跳过已有日程、全天事件；一键「应用排程到日程」批量生成时间块。
- **收件箱（GTD Inbox）**：「未整理」= 无截止时间的未完成待办；新增「收件箱」视图 + 「快速捕捉」弹窗（只填一个标题即入收件箱）。
- **全局快速捕捉**：主进程注册 `Ctrl/Cmd+Shift+N` 全局快捷键，任意界面唤起窗口并打开快速捕捉弹窗（`globalShortcut` + IPC + preload 暴露）。
- **周回顾（Weekly Review）**：新增「周回顾」视图，`utils.calcWeeklyReview` 汇总本周完成/新增/逾期/收件箱积压/缺预估耗时 + 四象限分布 + 需要关注清单 + 周回顾检查清单。

**移动端（安卓）**
- 待办表单支持「预估耗时」字段。
- 接入 `@notifee/react-native` 本地通知：依据待办 deadline 与日程 startTime 的 `remindBefore` 重排未来 7 天提醒；请求通知权限（Android 13+ `POST_NOTIFICATIONS`），数据变更防抖重排、退出登录自动清空；原生模块未链接时防御式降级 no-op。

**共享纯函数（shared/）**
- `utils.autoSchedule` / `utils.blockFromTodo` / `utils.calcWeeklyReview` 三个纯函数（可单测）。
- `constants.ESTIMATED_MINUTES_OPTIONS` / `WORK_HOURS` / `SCHEDULE_SLOT_MINUTES` / `SCHEDULE_BUFFER_MINUTES`。
- 新增 `test/gtd.test.js`（11 用例）；随后五轮全量测试又新增 `test/renderer.test.js`（11 用例，渲染层集成）与 `test/sync.gtd.test.js`（3 用例，同步字段保真），全量测试 119 项通过。

**说明**：桌面端提醒通知在 v1.x 已实现（`main.js` 每 30s 扫描 + 系统通知），本次补充的是移动端本地通知与排程/收件箱/周回顾体系；`estimatedMinutes` 仅作为待办记录字段随同步下发，无需服务端 schema 变更。

**五轮全量测试修复**：测试中发现并修复「跨天的全天日程在今日规划时间线中遗漏」的问题（`plan.js` 对全天事件把展开窗口起点前移一个事件时长）；并补齐渲染层集成测试与同步字段保真回归测试。

**随版本交付文档**：新增 `README/` 资料包——宣传资料 PDF、用户手册 PDF、培训 PPT（pptx）与培训考卷 PDF（含答案与答题卡），供发布与培训使用。

### v2.0.1（2026-08-22）— 同步正确性修复与安卓端 release APK 发布

在 v1.2.2 的多端同步架构上，逐项修复了同步正确性、数据安全与健壮性问题（对应 `server/`、`main.js`、`shared/` 三批改动），并完成安卓端 release APK 的构建发布。

**同步正确性（P0/P1）**
- **修复服务端 LWW 用「到达顺序」仲裁的丢编辑 bug**：服务端改用客户端 `updatedAt`（编辑时间）做 LWW 仲裁，新增 `client_updated_at` 列独立存储编辑时间；服务端单调递增的 `updated_at` 仅作增量拉取游标，二者职责分离。修复「离线设备带旧数据晚到推送就覆盖新数据」的问题。
- **修复 `toChange` 泄漏 `localModifiedAt`**：该字段为客户端内部追踪字段，此前随同步数据上传，导致别设备拉取后误判为「本地修改」而反复重推。
- **桌面端同步状态持久化**：`sync-state.json` 持久化服务器地址 / 游标 / token（token 用 `safeStorage` 加密），重启后不再丢失同步配置。
- **桌面端自动同步**：本地数据变更后防抖 2s 自动推送；启动时若已登录则自动拉取一次。
- **导入 / 恢复可同步**：导入的记录标记 `localModifiedAt`，下次同步会上传（此前导入数据永远停留在本地）。
- **settings 部分同步**：`urgentThresholdHours`（四象限紧急阈值）与 `defaultRemindBefore`（默认提醒）作为单条 `setting` 实体同步；`theme` 保持设备本地偏好。

**服务端安全与健壮性（P2）**
- `bcrypt` 改异步版本（`hash`/`compare`），避免同步阻塞事件循环被 DoS。
- 注册 / 登录加内存限流（IP + 端点，60s / 20 次）。
- JWT 密钥未设置时自动生成随机值并持久化到 `server/.secret`（拒绝内置默认值，`.gitignore` 已排除）。
- `express.json` 请求体上限 10mb → 2mb；`/api/sync` 拉取加分页（默认 500 / 上限 1000，`hasMore` 标志）。
- 启动时校验 Node 版本（`node:sqlite` 要求 Node ≥ 22.5）。
- `validateChanges` 收紧：entityType 枚举校验、单次 ≤ 1000 条、id 长度 ≤ 128。

**冲突提示（P3）**
- 桌面端拉取时检测「本地修改被远程覆盖」的冲突，弹 `Toast.warning` 提示（列出被覆盖的记录），不再静默丢编辑。

**测试与 CI**
- `verify-server.js` 从 14 项扩到 17 项：新增 LWW 按编辑时间回退（旧变更不覆盖新变更）、相等时间戳墓碑优先、`setting` 实体同步三个用例。
- `.github/workflows/build.yml` 新增 `server-test` 作业（Node 22 + `cd server && npm ci && node verify-server.js`），后端回归纳入 CI 门禁。

**安卓端发布（release APK）**
- CI 由 debug 改构建 **release APK**：`.github/workflows/build-apk.yml` 改为 `assembleRelease`，产物 `app-release.apk` 已内嵌 JS bundle，装手机即可独立运行、无需 Metro。
- 提交 `mobile/android/app/debug.keystore`（`mobile/.gitignore` 加 `!debug.keystore` 放行），`build.gradle` 用其给 debug/release 签名，修复 CI 拉取不到 keystore 导致签名失败的问题。
- 新增 `server/verify-e2e.js` 后端端到端测试：真实文件 DB + 重启持久化 + 注册/登录/多实体增量推送拉取/软删除墓碑全链路。
- `启动同步后端.bat` 改为纯 ASCII，避免 cmd 编码破坏命令。

**说明**：同步机制细节见 `SYNC.md`；后端部署见 `server/README.md`。

### v1.2.2（2026-08-15）— 多端同步架构（电脑端 + 安卓端 + 自建后端）

**共享包抽取（`shared/`）**
- 把 `utils.js`（重复展开/四象限/统计/搜索等纯函数）、`constants.js`、`migrate.js` 抽到 `shared/` 作为单一来源，桌面端 main/preload/renderer 与测试统一引用，删除原 `src/` 下的重复文件。
- 新增 `shared/sync.js`：同步纯函数（LWW 合并、软删除墓碑、增量提取、`extractLocalChanges` 本地修改追踪）。
- 新增 `shared/model.js`：实体类型契约与 change 校验。
- `test/sync.test.js`：13 个同步用例，全量测试 94 个用例通过。

**自建后端（`server/`）**
- Node + Express + 内置 `node:sqlite`（零编译依赖）+ JWT + bcryptjs。
- 用户注册/登录、记录级增量同步（`GET/POST /api/sync`）、服务端时间仲裁 + LWW 合并、多用户数据隔离。
- `verify-server.js`：14 项集成测试（注册/登录/增量推送拉取/软删除墓碑/多用户隔离）。

**桌面端改造**
- `store.js` 改为软删除 + 记录级 `updatedAt`/`localModifiedAt`：删除不再物理移除，`get()` 返回存活视图、`getRaw()` 返回含墓碑完整数据，渲染层行为不变。
- `main.js` 新增同步 IPC（`sync:login/pull/push/status/logout`）与拉推合并逻辑（复用 `shared/sync`）。
- 设置页新增「多端同步」卡片：服务器地址/用户名/密码登录注册、立即同步、退出登录。
- 同步拉取到新数据时自动刷新渲染层。

**React Native 安卓端（`mobile/`）**
- 完整 RN 项目（22 个文件）：登录/注册、日程（复用 `expandOccurrences` 展开重复）、待办（复用 `calcQuadrant` 四象限徽标 + 完成勾选）、同步客户端（复用 `shared/sync` 拉推合并）。
- 通过 `metro.config.js` watchFolders 复用 `../shared` 单一来源，未复制未重写。

**说明**：架构与启动步骤见 `SYNC.md`；后端部署见 `server/README.md`；安卓运行见 `mobile/README.md`。

### v1.2.1（2026-08-15）— 稳定性加固与体验升级

**稳定性与数据安全**
- **原子写盘**：`data.json` 改为「写临时文件 + rename 原子替换」，写入中断不再损坏数据文件；启动时自动清理残留临时文件。
- **渲染进程崩溃兜底**：监听 `render-process-gone`，崩溃 / OOM 时自动重建窗口并弹系统通知，带 10s 防崩溃循环保护；数据保存在主进程内存并已防抖落盘，崩溃不丢数据。
- **数据 schema 版本化**：`data.json` 顶层新增 `version` 字段，新增 `src/shared/migrate.js` 迁移框架（无 version 的历史数据视为 v1），启动加载与导入 / 恢复旧备份时自动迁移；v1→v2 迁移正式化早期 settings 深合并修复并防御顶层数组缺失。
- **CI 测试门禁**：GitHub Actions 新增 `test` 作业（ubuntu + `npm test`），mac / win 构建依赖其通过，测试失败不再浪费打包时间。
- **修复 mac 打包配置**：electron-builder 26 中 `arch` 已从 `mac` 顶层移除（`MacConfiguration` 无此属性），改为 `mac.target` 条目内的 `TargetConfiguration.arch`；原 `mac.arch` 写法导致 `dist:mac` schema 校验失败，双架构（x64 + arm64）已按新格式配置。

**统计真实性加固（五轮测试驱动）**
- **跨天曲线缺失修复**：统计页历史缓存此前只在首次进入时拉取一次，应用跨天后趋势曲线缺少昨日快照；现记录缓存拉取日期，跨天后自动重取。
- **历史加载失败卡死修复**：`getStatsHistory` 失败后 `historyLoading` 不再永久占用，下次 render 自动重试。
- **趋势合并逻辑提取**：`stats.js` 的 `mergedTrend` 提取为纯函数 `utils.mergeTrend`（30 天窗口 + 今天实时合并、不伪造缺失日期），供单元测试直接验证曲线真实性。
- **防御性加固**：`store.set` 对 settings 深合并（防部分字段覆盖丢配置）；主进程 `data:save` 仅接受形状正确的 payload 字段；待办列表 `filteredTodos` 只计算一次（两年数据下避免重复排序）。
- **新增 `test/trend.realism.test.js`（8 用例）**：历史快照与当日真实分布一致、当天快照仅保留最新、`mergeTrend` 窗口/覆盖/缺日语义、曲线自洽（每点象限和 == total）、趋势/卡片/穿透明细口径同源、90 天逐日快照与月视图展开性能。

**体验升级**
- **全文搜索**：新增「搜索」视图（导航 + `Ctrl+F` / `Cmd+F` 唤起），检索日程与待办的标题 / 描述 / 分类名，多关键词 AND、大小写不敏感；结果按时间排序并高亮命中词，日程可一键定位到日视图，待办可直接勾选完成 / 编辑；匹配逻辑 `utils.searchItems` 为纯函数，`test/search.test.js` 覆盖 9 类用例。
- **应用图标**：新增 `build/icon.png`（1024×1024，极简日历图形），electron-builder 打包时自动生成 `.ico` / `.icns`；运行窗口与托盘复用同一图标（`build/icon.png` 纳入打包产物）。
- **深色模式**：设置页新增「外观 → 界面主题」（跟随系统 / 浅色 / 深色），基于 CSS 变量实现，浅色主题零改动；跟随系统时实时响应系统主题切换。
- **系统托盘**：新增托盘常驻（图标 + 右键菜单：打开 / 退出）；关闭窗口默认最小化到托盘（首次弹提示），托盘点击恢复窗口；Windows 下设置 `setAppUserModelId` 保证通知 / 任务栏身份。

### v1.2.0（2026-08-15）— 统计页穿透、趋势可视化与刷新优化

**统计页穿透（下钻明细）**
- 数字卡片（今日/本周/本月完成、逾期、累计已完成）、完成率条形图行、四象限格子均可点击，展开底层明细列表。
- 明细中待办支持勾选完成/取消、编辑；日程支持「定位」跳转到对应日期的日视图（`schedule.goto`）。
- 明细口径与 `calcStats` / `calcQuadrantStats` 严格一致，避免数字与明细对不上。

**刷新问题修复**
- 修复「近 30 天趋势」里「今天」长期停留在当天首次快照、与顶部实时四象限卡片不一致的问题：
  - 渲染层实时计算「今天」并合并进趋势（`mergedTrend`），不再依赖主进程定时快照。
  - 主进程 `snapshotStats` 当天内改为更新最新值（仅变化时落盘），保证重启后历史数据仍准确。
- 历史快照本地缓存（`historyCache`），避免每次数据变更都全量 IPC 重取 + 重绘抖动；趋势卡新增「刷新」按钮可手动重取。
- 重绘时保留滚动位置与已展开的穿透面板，勾选/编辑明细后不再跳回顶部或收起。

**趋势可视化升级（堆叠面积图）**
- 「近 30 天趋势」由横向堆叠条形改为纯 SVG 堆叠面积图（无第三方库），X 轴日期、Y 轴未完成待办数，四象限固定配色堆叠。
- 支持「图 / 列表」切换；图含图例、十字线 + 悬停提示（列出当日四象限数值）；列表为明细表，作为无障碍可达替代。
- 颜色沿用四象限语义色（跨全应用一致），文字/图例使用中性墨色，不靠颜色单独承载身份。

**CI / 打包**
- `build.mac` 增加 `arch: [x64, arm64]`，修复 CI `macos-latest` 只出 arm64、Intel Mac 不兼容的问题。

### v1.1.0（2026-08-15）— 新增时间管理四象限

新增「时间管理四象限（艾森豪威尔矩阵）」，并做了一系列健壮性修复与压测。

**四象限模型（动态计算）**
- 重要性：手动标记（`important` / `not_important`）
- 紧急度：按截止时间动态推导（`now >= deadline - 紧急阈值`）
- 无截止时间 → 一律归为「不紧急」
- 象限：Q1 重要且紧急 / Q2 重要不紧急 / Q3 不重要但紧急 / Q4 不重要不紧急

**主要改动**
- 四象限模型、彩色徽标、配色、待办筛选与排序
- 统计页新增「四象限分布」卡片 +「近 30 天趋势」图
- 主进程每日快照 `statsHistory`（按日期去重、保留 90 天）
- 设置页新增「紧急阈值」（6/12/24/48/72 小时，默认 24）
- 修复两处健壮性 bug：`statsHistory` 读取的包装层解包、`settings` 深合并（旧数据缺 `urgentThresholdHours` 字段时不再丢失）

### v1.0.0（2026-08-14）— 初始版本

基础日程 / 待办管理，接入 GitHub Actions CI（push 构建 mac + win，`v*` 标签自动发布）。

> 附注：`c44cb2d`（2026-08-14）为 v1.0.0 之后的一个修复 —— 禁用 electron-builder 在 CI 中的隐式发布。

---

## 操作过程完整时间线

| 日期 | 操作 | 提交 / 标签 |
|------|------|-------------|
| 2026-08-14 | 初始版本 v1.0.0，接入 GitHub Actions CI | `16606be` |
| 2026-08-14 | 修复 CI 中 electron-builder 隐式发布问题 | `c44cb2d` |
| 2026-08-15 | 需求讨论：引入时间管理四象限，确定「动态计算 + 自动迁移/趋势图 + 无截止=不紧急」 | — |
| 2026-08-15 | 实现四象限功能（12 个源文件改动） | — |
| 2026-08-15 | 测试五轮，发现问题直接修复 | — |
| 2026-08-15 | 填入 2 年压测数据，完整抗压测试（700 日程 + 500 待办 = 1200 条） | — |
| 2026-08-15 | 提交并推送 GitHub，本地打包 Windows 安装包 | `86b95b0` |
| 2026-08-15 | 版本号规范化 1.0.0 → 1.1.0，打标签并推送，触发自动发布 | `1622222` / `v1.1.0` |
| 2026-08-15 | 重新打包本地 v1.1.0 安装包 | — |
| 2026-08-15 | v1.2.0：统计页穿透 + 趋势堆叠面积图 + 刷新优化 + CI 双架构 | — |

---

## 测试记录

- **单元 / 边界测试**：`test/utils.quadrant.test.js`（13 个用例，含边界）、`test/utils.boundary.test.js`、`test/store.test.js` 等，运行 `npm test`（`node --test`）。
- **schema 迁移测试**：`test/migrate.test.js`（8 个用例），覆盖旧数据自动迁移、设置保留、损坏文件防御与幂等性。
- **趋势真实性专项**：`test/trend.realism.test.js`（8 个用例，两年数据场景），覆盖历史快照真实性、当天快照更新语义、`mergeTrend` 合并窗口、曲线数据自洽与口径一致性、逐日快照与月视图展开性能（90 天快照 ~3ms、700 事件月视图展开 ~20ms）。
- **抗压测试**：
  - `test/stress-data.js`：确定性数据生成器（mulberry32 伪随机，可复现），2 年跨度、1200 条数据。
  - `test/stress.test.js`：6 项正确性 + 性能测试。
  - 实测性能：月视图展开 ~15ms、提醒扫描 ~11ms、统计 ~2ms、JSON 序列化 ~6ms，无 O(n²) 瓶颈。
- **应用实测**：载入 2 年数据后，四象限快照 q1=106 / q2=170 / q3=55 / q4=58（未完成待办合计 389）。
- 小注：`node --test` 会把 `test/stress-data.js`（纯生成器、无测试用例）也计为一个测试文件，多算 1 个，无害。

---

## 打包与发布

- **Windows**：`npm run dist` → `dist\日程管理 Setup <版本>.exe`（约 95 MB，NSIS 安装包）。
- **macOS**：CI（`macos-latest`）产出 `日程管理-<版本>.dmg` + `.zip`。
- 产物不入库：`.gitignore` 已排除 `dist/`、`安装包/`、`日程数据备份-*.json`。

---

## 已知问题 / 待办

- [ ] **Mac 未签名、未公证**：Gatekeeper 会拦截并提示「已损坏，无法打开」，需 `xattr -cr` 绕过。彻底解决需 Apple Developer 签名 + 公证（`build.mac` 配置 `identity` + `notarize`）。
- [x] **应用图标**：v1.2.1 已配置 `build/icon.png`（1024×1024），打包时自动生成 `.ico` / `.icns`（待下次打包验证效果）。

---

## 环境备注

- 本机 git 不在 PATH，需使用完整路径 `C:\Program Files\Git\bin\git.exe`。
- 打包依赖 `electron-builder ^26.15.3`，`electron ^43.4.0`。
