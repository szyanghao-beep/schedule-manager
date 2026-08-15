# 日程管理同步后端

自建的多端同步后端：用户认证（JWT）+ 记录级增量同步 + 服务端时间仲裁（LWW）。
支持多人（每个用户数据隔离）。SQLite 存储（Node 内置 `node:sqlite`，零编译依赖），可平滑迁移到 PostgreSQL。

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
| `SECRET` | 内置默认值 | JWT 签名密钥，**生产必须改成强随机字符串** |
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
| GET | `/api/sync?since=<ts>` | Bearer | 拉取 `since` 之后的增量变更 |
| POST | `/api/sync` | Bearer | 推送 `{changes:[...]}`，服务端时间仲裁 + LWW 合并 |

## 同步协议要点

- **记录级增量**：每条记录带 `{id, entityType, deleted(软删除墓碑), updatedAt}`。
- **软删除墓碑**：删除不物理删，只置 `deleted=true`，避免已删记录从其它设备"复活"。
- **服务端时间仲裁**：每条 change 到达时盖「服务端递增时间戳」，不信任设备本地时钟；LWW 取更新时间新者，相等时墓碑优先。
- **多用户隔离**：所有记录按 `user_id` 隔离。

## 验证

```bash
node verify-server.js    # 14 项集成测试（注册/登录/增量推送拉取/软删除/多用户隔离）
```

## 从 SQLite 迁移 PostgreSQL（生产建议）

数据层已收敛在 `src/db.js`（表结构）与 `src/syncRoutes.js`（读写）。迁移时：

1. 用 `pg` 替换 `node:sqlite`，保持同样的 `records(user_id, entity_type, entity_id, deleted, updated_at, data_json)` 表结构；
2. `INSERT ... ON CONFLICT DO UPDATE` 在 PostgreSQL 为 `INSERT ... ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE`（语法一致）；
3. 其余路由逻辑无需改动。

## 已知限制

- LWW 按服务端**到达顺序**仲裁：两台设备在各自未拉取到对方更新前先后推送同一条记录时，后到者胜。这是 MVP 简化；需要更强的并发语义可升级为版本向量 / CRDT。
- 未做 HTTPS（生产请置于 Nginx/Caddy 反代之后加 TLS）。
- `settings`（本地偏好）不同步，各端独立。
