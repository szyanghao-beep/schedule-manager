/*
 * syncRoutes.js — 同步端点（记录级增量 + 服务端时间仲裁 + LWW）
 *
 * 同步协议：
 *   GET  /api/sync?since=<毫秒时间戳>
 *        返回该用户 since 之后的所有变更（含软删除墓碑）
 *   POST /api/sync  body { changes: [{entityType,id,deleted,updatedAt,data}] }
 *        上传本地变更；服务端对每条 change 盖「服务端递增时间戳」做仲裁，
 *        再用 shared/sync.lww 与现有记录合并（到达晚者胜，墓碑优先）。
 *
 * 说明：服务端时间仲裁避免依赖设备本地时钟；但「同一条记录被两台设备在
 * 各自未拉取对方更新前先后推送」的并发冲突，LWW 会以服务端到达顺序为准，
 * 属于可接受的 MVP 简化，后续可用版本向量/CRDT 增强。
 */
'use strict';

const sync = require('../../shared/sync.js');
const model = require('../../shared/model.js');

function rowToChange(row) {
  return {
    entityType: row.entity_type,
    id: row.entity_id,
    deleted: !!row.deleted,
    updatedAt: row.updated_at,
    data: JSON.parse(row.data_json),
  };
}

function registerSyncRoutes(app, db, authenticate) {
  // 增量拉取
  app.get('/api/sync', authenticate, function (req, res) {
    const since = parseInt(req.query.since, 10) || 0;
    const rows = db.prepare(
      'SELECT * FROM records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC'
    ).all(req.user.id, since);
    res.json({ changes: rows.map(rowToChange), serverTime: Date.now() });
  });

  // 增量推送（服务端时间仲裁 + LWW 合并）
  app.post('/api/sync', authenticate, function (req, res) {
    const body = req.body || {};
    const v = model.validateChanges(body.changes);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const select = db.prepare(
      'SELECT * FROM records WHERE user_id = ? AND entity_type = ? AND entity_id = ?'
    );
    const upsert = db.prepare(`
      INSERT INTO records (user_id, entity_type, entity_id, deleted, updated_at, data_json)
      VALUES (@user_id, @entity_type, @entity_id, @deleted, @updated_at, @data_json)
      ON CONFLICT(user_id, entity_type, entity_id)
      DO UPDATE SET deleted = @deleted, updated_at = @updated_at, data_json = @data_json
    `);

    // 服务端递增时间戳：同一批 change 内顺序确定，且一定大于历史
    let t = Date.now();

    for (const ch of body.changes) {
      t = Math.max(Date.now(), t + 1);
      const incoming = {
        id: ch.id,
        entityType: ch.entityType,
        deleted: !!ch.deleted,
        updatedAt: t,
        data: Object.assign({}, ch.data, { id: ch.id }), // 业务数据强制带 id
      };

      const existingRow = select.get(req.user.id, ch.entityType, ch.id);
      let winner = incoming;
      if (existingRow) {
        const existing = {
          id: existingRow.entity_id,
          entityType: existingRow.entity_type,
          deleted: !!existingRow.deleted,
          updatedAt: existingRow.updated_at,
          data: JSON.parse(existingRow.data_json),
        };
        winner = sync.lww(existing, incoming);
      }

      upsert.run({
        user_id: req.user.id,
        entity_type: winner.entityType,
        entity_id: winner.id,
        deleted: winner.deleted ? 1 : 0,
        updated_at: winner.updatedAt,
        data_json: JSON.stringify(winner.data), // 只存业务数据，不嵌套同步元字段
      });
    }

    res.json({ serverTime: t });
  });
}

module.exports = { registerSyncRoutes };
