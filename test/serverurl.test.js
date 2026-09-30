/*
 * serverurl.test.js — 同步服务器地址归一化的单元测试 + 「单一实现」契约测试
 *
 * 背景（真实故障）：
 *   1. 手机端填了 `192.168.1.6:8787`（漏 http:// 且网段与电脑真实网段 192.168.0.x 不符），
 *      连不上电脑内嵌同步服务。原因是手机端 normalizeUrl 当时没有自动补协议。
 *   2. 桌面端与手机端各自实现了一份地址归一化，容错能力不一致 → 出现「电脑能连、手机连不上」。
 *   3. 示例代码里预置了 `192.168.1.100:8787` 这类编造 IP，用户照抄后必然连不上。
 *
 * 本测试锁定三件事：
 *   a) normalizeServerUrl 的行为边界（含空值、协议、尾斜杠、空格）
 *   b) 桌面端 main.js、手机端 api.js / inboxDrop.js 都委托给 shared 的同一实现
 *   c) 仓库里不再残留会误导用户的示例 IP
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Utils = require('../shared/utils.js');

const ROOT = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

test('normalizeServerUrl: 缺协议自动补 http://（手机端填 IP:端口 的常见场景）', function () {
  assert.strictEqual(Utils.normalizeServerUrl('192.168.0.106:8787'), 'http://192.168.0.106:8787');
  assert.strictEqual(Utils.normalizeServerUrl('10.0.2.2:8787'), 'http://10.0.2.2:8787');
});

test('normalizeServerUrl: 去首尾空白与末尾斜杠', function () {
  assert.strictEqual(
    Utils.normalizeServerUrl('  http://192.168.0.106:8787//  '),
    'http://192.168.0.106:8787'
  );
  assert.strictEqual(Utils.normalizeServerUrl('192.168.0.106:8787/'), 'http://192.168.0.106:8787');
});

test('normalizeServerUrl: 已是合法协议则原样保留（含 https）', function () {
  assert.strictEqual(Utils.normalizeServerUrl('http://192.168.0.106:8787'), 'http://192.168.0.106:8787');
  assert.strictEqual(Utils.normalizeServerUrl('https://sync.example.com'), 'https://sync.example.com');
});

test('normalizeServerUrl: 空输入返回空串（由调用方给报错文案，不静默兜底到错误地址）', function () {
  assert.strictEqual(Utils.normalizeServerUrl(''), '');
  assert.strictEqual(Utils.normalizeServerUrl('   '), '');
  assert.strictEqual(Utils.normalizeServerUrl(null), '');
  assert.strictEqual(Utils.normalizeServerUrl(undefined), '');
});

test('normalizeServerUrl: 幂等（重复归一化结果不变）', function () {
  const once = Utils.normalizeServerUrl('192.168.0.106:8787');
  assert.strictEqual(Utils.normalizeServerUrl(once), once);
});

test('契约：桌面端与手机端共用 shared 的同一实现（防再次各写一份导致容错不一致）', function () {
  const main = read('main.js');
  const mobileApi = read('mobile/src/api.js');
  const mobileDrop = read('mobile/src/inboxDrop.js');

  assert.ok(
    /Utils\.normalizeServerUrl\(/.test(main),
    'main.js 应委托 Utils.normalizeServerUrl，而不是自己实现地址归一化'
  );
  assert.ok(
    /shared\.utils\.normalizeServerUrl/.test(mobileApi),
    'mobile/src/api.js 应委托 shared.utils.normalizeServerUrl'
  );
  assert.ok(
    /shared\.utils\.normalizeServerUrl/.test(mobileDrop),
    'mobile/src/inboxDrop.js 应委托 shared.utils.normalizeServerUrl'
  );

  // 不应再有自行拼 http:// 的实现（出现即说明又复制了一份逻辑）
  const dup = [];
  [['main.js', main], ['mobile/src/api.js', mobileApi], ['mobile/src/inboxDrop.js', mobileDrop]]
    .forEach(function (pair) {
      if (/'http:\/\/'\s*\+/.test(pair[1])) dup.push(pair[0]);
    });
  assert.deepStrictEqual(dup, [], '这些文件又自行拼接了 http:// 前缀，应改用 shared 实现：' + dup.join(', '));
});

test('契约：示例文案里不残留编造的 192.168.1.x 地址（曾误导用户照抄）', function () {
  const files = ['mobile/src/api.js', 'mobile/src/inboxDrop.js', 'mobile/src/screens/CollectScreen.js',
    'mobile/src/screens/LoginScreen.js', 'src/renderer/js/modules/settings.js'];
  const bad = [];
  files.forEach(function (f) {
    read(f).split('\n').forEach(function (line, i) {
      // 允许注释里提到这个网段用于说明历史故障，但不允许出现在 placeholder/初始值中
      const isPlaceholder = /placeholder\s*[:=]/.test(line) || /DEFAULT_SERVER_URL\s*=/.test(line);
      if (isPlaceholder && /192\.168\.1\.\d+/.test(line)) bad.push(f + ':' + (i + 1));
    });
  });
  assert.deepStrictEqual(bad, [], 'placeholder/默认值里仍有编造的示例 IP：' + bad.join(', '));
});
