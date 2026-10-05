/**
 * findPc.js — 「自动查找电脑」：按网段扫描并找出运行同步服务的电脑。
 *
 * 为什么需要：同步地址跟着**电脑**走，换电脑/换路由器后 IP 与网段都会变。
 * 让用户去查 IP、再手输，既麻烦又容易写错网段（真实发生过：电脑是 192.168.0.x，
 * 用户填了 192.168.1.x，怎么都连不上）。所以让手机自己去找。
 *
 * 做法：
 *   1. 先试「上次成功连过的网段」（最可能命中），再退化到常见家用/办公网段；
 *   2. 每个网段扫最后一段 1~254，只打 /health，有并发上限与超时，避免长时间卡住；
 *   3. 用 /health 里的 app 字段确认**这就是我们的服务**，
 *      而不是某个碰巧占用 8787 端口的其它程序（否则会误判成找到了）；
 *   4. 命中即返回，不再继续扫剩下的。
 *
 * 候选地址与网段排序复用 shared/utils.js（与桌面端同一套实现）。
 */
const shared = require('./shared');

const DEFAULT_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 700;
const DEFAULT_CONCURRENCY = 24;

/**
 * 探测单个地址是否是我们的电脑。
 * @returns {Promise<{ok:boolean, app?:string, version?:string}>}
 */
async function probe(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + '/health', { signal: controller.signal });
    if (!res.ok) return { ok: false };
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) return { ok: false };
    // 必须确认是我们的服务：同网段里别的程序也可能占 8787
    if (body.app !== 'schedule-manager') return { ok: false, wrongApp: true };
    return { ok: true, app: body.app, version: body.version || '' };
  } catch (e) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 自动查找电脑。
 * @param {object} opts
 *   lastGoodUrl  上次成功连过的地址（用来优先扫它所在网段）
 *   port         端口，默认 8787
 *   timeoutMs    单个地址超时，默认 700
 *   concurrency  并发上限，默认 24
 *   maxPrefixes  最多扫几个网段，默认 2（先扫最可能的，避免一上来就狂扫）
 *   onProgress(p) 进度回调 { scanned, total, prefix, found }
 * @returns {Promise<{url:string}|{url:null, reason:string}>}
 */
async function findPc(opts) {
  const o = opts || {};
  const port = o.port || DEFAULT_PORT;
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  const concurrency = o.concurrency || DEFAULT_CONCURRENCY;
  const maxPrefixes = o.maxPrefixes || 2;

  // prefixes / range 是给测试用的开口：测试里可以只在 127.0.0.x 的小范围内扫，
  // 既不依赖真实局域网，也跑得快（生产走默认值：上次成功的网段 + 常见网段，1~254）。
  const prefixes = (Array.isArray(o.prefixes) && o.prefixes.length)
    ? o.prefixes.slice(0, maxPrefixes)
    : shared.utils.scanPrefixes(o.lastGoodUrl).slice(0, maxPrefixes);
  if (!prefixes.length) return { url: null, reason: 'no-candidates', scanned: 0 };
  const range = o.range || {};

  const total = prefixes.reduce(function (n, p) {
    return n + shared.utils.subnetCandidates(p, port, range).length;
  }, 0);

  let scanned = 0;
  let foundUrl = null;

  function report(prefix) {
    if (typeof o.onProgress === 'function') {
      o.onProgress({ scanned: scanned, total: total, prefix: prefix, found: foundUrl });
    }
  }

  for (const prefix of prefixes) {
    if (foundUrl) break;
    const queue = shared.utils.subnetCandidates(prefix, port, range);
    let idx = 0;

    // 有界并发的「工作池」：起 concurrency 个 worker，谁空谁取下一个。
    // 找到目标就置 foundUrl，其余 worker 自行退出（不再白白扫剩下的地址）。
    async function worker() {
      while (!foundUrl) {
        const i = idx++;
        if (i >= queue.length) return;
        const url = queue[i];
        const r = await probe(url, timeoutMs);
        scanned += 1;
        if (r.ok) { foundUrl = url; report(prefix); return; }
        if (scanned % 20 === 0) report(prefix);
      }
    }

    const workers = [];
    for (let k = 0; k < concurrency; k++) workers.push(worker());
    await Promise.all(workers);
    report(prefix);
  }

  if (foundUrl) return { url: foundUrl, reason: 'ok', scanned: scanned, total: total };
  return { url: null, reason: 'not-found', scanned: scanned, total: total };
}

module.exports = { findPc, probe, DEFAULT_PORT };
