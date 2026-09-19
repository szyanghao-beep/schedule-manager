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
| 当前版本 | **v2.3.2** |

---

## 版本历史

### v2.3.2（2026-09-07）— 客户商机跟进 + 手机端收集直传

**新增：客户商机跟进（客户视图）**

面向销售场景的持续跟进闭环：从发现商机到落单赢单，保证「不间断跟进、不遗漏」。

- **客户档案**：客户名/联系人/电话/负责人/备注；阶段流转（发现商机 → 需求沟通 → 系统演示 → 商务报价 → 合同谈判 → 赢单/输单）
- **金额流水（核心设计）**：金额不是单一字段，而是一条留痕流水
  - `预估`：可**多次调整**（未落单前列表显示最新预估，历史保留可回溯）
  - `落单确认`：阶段改为「赢单」时**强制填写成交金额**（这就是"落单才确认"的机制化，且落单仅一次）
  - `增购`：赢单后可**多次追加**，累加进该客户累计成交额
  - 派生值实时计算（当前预估 / 首单成交 / 增购累计 / 累计成交），不落库、不会不一致
  - 统计区分两套口径：**漏斗**（未成交预估合计）与**业绩**（实际成交）
- **跟进记录 + 自动提醒（关键复用）**：记录跟进时「下次跟进时间」为**必填** → 自动生成一条普通待办
  `跟进：客户名（阶段）`，`deadline = 下次跟进时间`
  - 因此直接复用现有待办的**提醒、四象限、今日规划、时间块、周回顾**全部能力，未新增任何提醒或规划机制
  - 再次跟进自动更新同一条未完成待办，不堆积
- **阶段留痕**：`stageHistory` 记录何时进入哪个阶段，可算出每段停留天数（看商机卡在哪一段）
- **列表与详情**：按阶段分组/筛选、超期未跟进标红、客户详情含金额流水与跟进时间线
- **多端同步**：客户与跟进记录纳入同步（`ENTITY_TYPES` 新增 `customer`/`followup`，主进程拉推白名单接线），后端零改动

**手机端「收集」→ 局域网直传 → 电脑收件箱**（免登录）

- 手机「收集」Tab：离线随手记待办/想法（连续录入、待同步计数），纯手动不联网
- 电脑端内嵌服务器新增免登录端点 `POST /api/inbox-drop`（配对码校验 + id 幂等去重）
- 条目规范化为 `deadline: null, status: 'pending'`，正好等于电脑端「收件箱（未整理）」的定义，直接落进收件箱等待整理
- 电脑端设置页显示**本机局域网 IP** 与 **6 位收集口令**（由同步密钥 HMAC 派生）

**同期修复**

- 修复重复日程保存失败：`validateEvent` 用 `in` 检查 `repeat.type` 的 key（大写）而非值（小写），
  导致 daily/weekly/monthly 全被误判「重复规则无效」、重复功能彻底失效
- 修复月视图日期与星期表头列不对齐（`.cal-weekday` 补边框结构）、内容多时整月看不全（降 min-height + overflow）

**测试**：全量 236 用例通过（新增 customer 15 例 + store 层客户业务 9 例）；
后端回归 verify-server(17) + verify-e2e(6) + verify-inbox-drop(16) 全通过。

### v2.3.1（2026-08-23）— 内嵌同步服务器（桌面端即同步中心）

修复 v2.3.0 安装包「后端服务未打包、安装后无法启动同步服务」的问题，并改用**方案 A：把 Express 后端内嵌进桌面 App**——桌面 App 启动时在本机同进程跑起 8787 端口同步服务，桌面端自己就是同步中心。

- **后端内嵌**：`main.js` 增加 `startSyncServer()`/`stopSyncServer()`，惰性加载 `server/src/app.js` + `server/src/db.js`，用 Electron 43.4.0 内置的 Node v24 `node:sqlite` 直连 `userData/sync-server.db`，无需单独安装 Node 或手动启动服务。
- **设置页开关**：设置页新增「本机同步服务（同步中心）」卡片，勾选启用即启动 8787 服务并**下次开机自动启动**（状态持久化 `userData/sync-server.json`）；界面实时显示运行状态与「手机端地址 http://<本机局域网IP>:8787」。
- **JWT 密钥**：`resolveSyncServerSecret()` 优先读 `SCHEDULE_SYNC_SECRET` 环境变量，否则在 `userData/sync-server.secret` 自动生成并持久化。
- **打包修复**：`build.files` 增加 `server/src/**/*`；`dependencies` 补齐 `express`/`cors`/`jsonwebtoken`/`bcryptjs`（随 `app.asar` 一起打包）。
- **退出清理**：`will-quit` 中调用 `stopSyncServer()`，端口随 App 退出释放。

验证：打包后的 `dist/win-unpacked/日程管理.exe` 启动即拉起 8787 服务，`/health` 返回 ok，注册（200）/推送（accepted=1）/拉取（1 条「测试日程」）全链路通过。

### v2.3.0（2026-08-23）— 日历增强（农历/节气/节假日/纪念日）+ 收支记账

在 v2.2.0 基础上交付两大模块：**A. 日历增强**（农历、二十四节气、法定节假日 + 调休、生日/纪念日提醒）与 **B. 收支记账**（多账户 + 流水 + 二级分类 + 预算 + 报表）。

**A. 日历增强**
- **农历与节气**：接入 `lunar-javascript`（vendored `shared/vendor/lunar.js`），`shared/lunar.js` 封装农历月/日中文、二十四节气、节假日查询；月/日视图与今日规划标注农历、节气与节假日徽标。
- **法定节假日 + 调休**：`getHoliday` / `isWorkday` / `isRestDay` 内置 2026 数据；设置页新增「节假日数据」卡片，支持 JSON 手动导入/覆盖新年度（A5），自定义数据优先于内置。
- **休息日影响排程**：设置项 `restDayAffectsPlanning` 默认开启，休息日自动排程短路并提示（A6）。
- **生日/纪念日**：新增「纪念日」实体与视图（名称/类型/公历或农历/提前 N 天提醒），农历生日走 lunar 库换算（A4/A7）；每日邮件摘要新增「今日纪念日」段落；主进程到点弹系统通知。

**B. 收支记账（账户维度单式）**
- `shared/bookkeeping.js` 纯函数（UMD，三端复用）：金额整数「分」存储、`formatCents` / `yuanToCents` / 流水流向 / 账户余额 / 区间收支 / 分类构成 / 预算状态 / 转账构建。
- **账户 + 流水 + 分类**：新增账户（现金/银行卡/信用卡/电子钱包/投资/其他，含初始余额/归档）、流水（收入/支出/转账，转账即信用卡还款）、记账分类（独立于日程分类，可初始化默认 10 项）。
- **记账视图**：四个子页「明细 / 账户 / 报表 / 预算」；明细含月度收支汇总与流水增删改；账户页含余额、归档、转账/还款快捷入口、分类管理。
- **预算 + 超支预警**：总预算或按分类的月度限额，进度条 + 超支标红，记支出时即时预警（B4）。
- **报表四件套**：结余率、分类支出构成（环形图）、近 6 个月收支趋势、消费日历热力图（B5）。

**迁移与工程**
- `shared/migrate.js` `DATA_VERSION` 3 → 4：补齐 `accounts` / `transactions` / `bookkeepingCategories` / `budgets` / `memorials` 五个数组与 `settings.calendar` / `settings.bookkeeping` / `settings.holidayData` 子对象。
- 测试套件 200 条通过（新增 `test/bookkeeping.test.js`、`test/lunar.test.js` 节假日覆盖与农历中文、`test/digest.test.js` 纪念日段落、`test/renderer.test.js` 纪念日与记账视图）。

### v2.2.0（2026-08-22）— 提醒增强 + 邮件提醒 + C1 自然语言快速捕捉

在 v2.1.0 基础上落地 v2.2.0 三大范围：提醒增强（扩展提前量 / 自定义时间点 / 通知操作条 / 稍后提醒 / 一条多提醒）、邮件提醒（每日待办摘要）、以及方案 C 首个 AI 功能 C1「自然语言快速捕捉」（规则优先 + 可选 LLM 兜底）。

**提醒增强**
- **扩展提前量**：`REMIND_OPTIONS` 增加小时/天级（120/180/720/1440/2880 分钟），支持提前数天提醒。
- **自定义时间点**：新增 `remindAt` 字段，可指定某个具体时间点提醒（独立于 `remindBefore` 提前量）。
- **通知可行动（操作条）**：点击系统通知 → 打开并定位到对应条目 → 弹「操作条」（完成 / 稍后 10 分钟 / 稍后 1 小时），不再只是被动提示。
- **稍后提醒 snooze**：桌面 `snoozed` 映射 + 移动端重排新时间戳，可延后提醒。
- **一条多提醒**：新增 `reminds: number[]` 数组替代单一 `remindBefore`，`effectiveReminds(item)` 统一优先读数组、回退旧字段；`shared/migrate.js` DATA_VERSION 3 把旧 `remindBefore` 幂等迁移为 `reminds`。

**邮件提醒（每日待办摘要）**
- 新依赖 `nodemailer`；设置页新增「邮件提醒」卡片（开关、收件邮箱、发送时间默认 8:00、SMTP host/port/user/secure/fromName）。
- SMTP 授权码用 `safeStorage` 加密独立存储（`email-secret.json`），与同步 token 同模式。
- 调度挂现有 30s 循环，到点 + 当日未发则发送（`emailLastSentDate` 去重）；桌面端发送，电脑关机当天漏发可接受（已确认）。
- `shared/digest.js` 新增 `buildDailyDigest(data, now)` 纯函数 → `{subject, text, html}`，含今日待办 / 逾期未完成 / 今日日程 / 收件箱积压 / 今日概览，HTML 转义防注入。
- 隐私默认关闭，设置页标注「邮件内容将经过你的邮箱服务商」。

**C1 自然语言快速捕捉（方案 C 混合接入）**
- `shared/nlp.js`：规则版中文解析器（纯函数、离线、三端复用 UMD），抽取标题 / 类型（todo/event）/ 截止 / 开始结束 / 全天 / 优先级 / 重要性 / #分类 / 提前提醒 / 预估耗时 / 置信度；覆盖相对日期（明天/后天/下周一）、绝对日期、上下午 12 小时制、时长与「预计」区分。
- `ai/llm.js` + `ai/index.js`：可选 LLM 兜底，OpenAI 兼容 `/chat/completions` 协议（Ollama `/v1` 与 OpenAI 均可）；`parseQuickCapture` 先规则后 LLM，规则未抽出时间字段且 AI 启用时才调 LLM；LLM 返回严格 JSON，解析/校验失败或异常一律回退规则结果，**绝不静默改数据**。
- 设置页新增「AI」卡片（开关、提供商 Ollama/OpenAI、endpoint、模型名、API key `safeStorage` 加密），默认关闭，纯规则解析即可用。
- 快速捕捉弹窗改造：输入自然语言 → 实时预览解析结果（规则即时 + AI 增强 400ms 防抖）→ 用户确认后按类型创建待办（截止/优先级/分类/重要性/提醒/预估耗时）或日程（开始/结束/全天），未识别时间则入收件箱。

**测试**：新增 `test/nlp.test.js`（25 用例）、`test/digest.test.js`（7 用例）、`test/ai.test.js`（6 用例），并更新 `test/renderer.test.js` 覆盖快速捕捉自然语言解析链路；全量测试 **162 项通过**。

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
| 2026-08-22 | v2.2.0：提醒增强 + 邮件提醒 + C1 自然语言快速捕捉（规则 + 可选 LLM） | — |

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
