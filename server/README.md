# 日程管理同步后端

自建的多端同步后端：用户认证（JWT）+ 记录级增量同步 + 客户端编辑时间仲裁（LWW）。
支持多人（每个用户数据隔离）。SQLite 存储（Node 内置 `node:sqlite`，零编译依赖），可平滑迁移到 PostgreSQL。

> 环境要求：Node ≥ 22.5（`node:sqlite` 为内置模块），`server.js` 启动时会校验版本并给出提示。

## 运行

```bash
cd server
npm install
npm start          # 默认监听 0.0.0.0:8787
```

环境变量（可选）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8787` | 监听端口 |
| `SECRET` | 自动生成 | JWT 签名密钥；未设置时自动生成随机值并持久化到 `server/.secret` |
| `DB_PATH` | `server/data.db` | SQLite 数据库文件路径 |

示例（生产）：

```bash
# Linux/macOS
SECRET="$(openssl rand -hex 32)" PORT=8787 npm start
# Windows PowerShell
$env:SECRET = "一个长随机字符串"; npm start
```

## API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health` | 无 | 健康检查 |
| POST | `/api/auth/register` | 无 | `{username, password}` → `{token, user}` |
| POST | `/api/auth/login` | 无 | `{username, password}` → `{token, user}` |
| GET | `/api/sync?since=<ts>&limit=<N>` | Bearer | 拉取 `since` 之后的增量变更（分页，默认 500 / 上限 1000，`hasMore` 标志） |
| POST | `/api/sync` | Bearer | 推送 `{changes:[...]}`，按客户端编辑时间 LWW 合并 |

## 同步协议要点

- **记录级增量**：每条记录带 `{id, entityType, deleted(软删除墓碑), updatedAt}`。
- **软删除墓碑**：删除不物理删，只置 `deleted=true`，避免已删记录从其它设备"复活"。
- **LWW 按客户端编辑时间**：服务端按 change 声明的 `updatedAt`（编辑时间）仲裁，新者胜、相等时墓碑优先；另盖单调递增的 `updated_at` 仅作增量拉取游标，二者职责分离。
- **多用户隔离**：所有记录按 `user_id` 隔离。

## 验证

```bash
npm test               # 同 node verify-server.js
node verify-server.js  # 17 项集成测试（注册/登录/增量推送拉取/软删除/LWW 回退/多用户隔离）
```

## 从 SQLite 迁移 PostgreSQL（生产建议）

数据层已收敛在 `src/db.js`（表结构）与 `src/syncRoutes.js`（读写）。迁移时：

1. 用 `pg` 替换 `node:sqlite`，保持同样的 `records(user_id, entity_type, entity_id, deleted, updated_at, client_updated_at, data_json)` 表结构；
2. `INSERT ... ON CONFLICT DO UPDATE` 在 PostgreSQL 为 `INSERT ... ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE`（语法一致）；
3. 其余路由逻辑无需改动。

## 已知限制

- LWW 按客户端**编辑时间**仲裁：客户端时钟严重漂移时仍可能误判；对同一记录真正的并发编辑要因果正确，需升级为版本向量 / CRDT。
- 未做 HTTPS（生产请置于 Nginx/Caddy 反代之后加 TLS）。
- `settings` 部分同步（仅 `urgentThresholdHours` / `defaultRemindBefore`），`theme` 等本地偏好仍各端独立。
