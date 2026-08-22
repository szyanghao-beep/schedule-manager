/*
 * syncRoutes.js — 同步端点（记录级增量 + 服务端时间仲裁 + LWW）
 *
 * 同步协议：
 *   GET  /api/sync?since=<服务端时间戳>&limit=<N>
 *        返回该用户 since 之后的所有变更（含软删除墓碑），按 updated_at 升序。
 *   POST /api/sync  body { changes: [{entityType,id,deleted,updatedAt,data}] }
 *        上传本地变更；服务端按「客户端 updatedAt（编辑时间）」做 LWW 仲裁：
 *        客户端编辑时间新者胜；相等时墓碑（deleted）优先。
 *        仅当 change 被采纳时才盖「服务端递增时间戳」作为增量拉取游标。
 *
 * 关键修正：LWW 比较的是客户端声明的编辑时间（updatedAt），而不是服务端到达时间。
 * 服务端时间戳（updated_at）只用于增量拉取排序/游标，二者职责分离，避免
 * 「离线设备带着旧数据晚到推送就覆盖新数据」的丢编辑问题。
 *
 * 局限（LWW 固有）：客户端时钟严重漂移时仍可能误判；对同一记录真正的并发编辑
 * 需要版本向量/CRDT 才能做到因果正确（见 SYNC.md）。
 */
'use strict';

const sync = require('../../shared/sync.js');
const model = require('../../shared/model.js');

// 跨请求单调递增的服务端时间戳，保证增量游标 updated_at 严格递增，
// 不因同毫秒写入或时钟回拨导致漏拉/重复拉取。
let lastServerTime = 0;

function rowToChange(row) {
  let data;
  try {
    data = JSON.parse(row.data_json);
  } catch (e) {
    data = { id: row.entity_id }; // data_json 损坏时兜底，不让整批拉取 500
  }
  return {
    entityType: row.entity_type,
    id: row.entity_id,
    deleted: !!row.deleted,
    updatedAt: row.updated_at,
    data: data,
  };
}

function registerSyncRoutes(app, db, authenticate) {
  // 增量拉取（含软删除墓碑），带分页保护避免一次吐出无限数据
  app.get('/api/sync', authenticate, function (req, res) {
    const since = parseInt(req.query.since, 10) || 0;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const rows = db.prepare(
      'SELECT * FROM records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT ?'
    ).all(req.user.id, since, limit);
    const changes = rows.map(rowToChange);
    res.json({
      changes: changes,
      hasMore: changes.length === limit, // 达到上限说明可能还有更多，客户端可继续分页
      serverTime: lastServerTime || Date.now(),
    });
  });

  // 增量推送（客户端时间 LWW 仲裁 + 服务端时间戳作游标）
  app.post('/api/sync', authenticate, function (req, res) {
    const body = req.body || {};
    const v = model.validateChanges(body.changes);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const select = db.prepare(
      'SELECT * FROM records WHERE user_id = ? AND entity_type = ? AND entity_id = ?'
    );
    const upsert = db.prepare(`
      INSERT INTO records (user_id, entity_type, entity_id, deleted, updated_at, client_updated_at, data_json)
      VALUES (@user_id, @entity_type, @entity_id, @deleted, @updated_at, @client_updated_at, @data_json)
      ON CONFLICT(user_id, entity_type, entity_id)
      DO UPDATE SET deleted = @deleted, updated_at = @updated_at, client_updated_at = @client_updated_at, data_json = @data_json
    `);

    let t = Math.max(Date.now(), lastServerTime + 1);
    let accepted = 0;

    for (const ch of body.changes) {
      const clientTime = typeof ch.updatedAt === 'number' ? ch.updatedAt : 0;
      const existingRow = select.get(req.user.id, ch.entityType, ch.id);

      let shouldWrite = true;
      if (existingRow) {
        // 旧库记录可能无 client_updated_at，回退用 updated_at（服务端时间）兜底
        const existingClientTime =
          existingRow.client_updated_at != null ? existingRow.client_updated_at : existingRow.updated_at;
        // LWW：客户端编辑时间新者胜；相等时墓碑优先（防已删记录被旧副本复活）
        if (clientTime < existingClientTime) {
          shouldWrite = false;
        } else if (clientTime === existingClientTime && !ch.deleted && existingRow.deleted) {
          shouldWrite = false;
        }
      }

      if (shouldWrite) {
        t = Math.max(t + 1, Date.now());
        upsert.run({
          user_id: req.user.id,
          entity_type: ch.entityType,
          entity_id: ch.id,
          deleted: ch.deleted ? 1 : 0,
          updated_at: t,
          client_updated_at: clientTime,
          data_json: JSON.stringify(Object.assign({}, ch.data, { id: ch.id })), // 业务数据强制带 id
        });
        accepted += 1;
      }
    }

    lastServerTime = t;
    res.json({ serverTime: t, accepted: accepted });
  });
}

module.exports = { registerSyncRoutes };
