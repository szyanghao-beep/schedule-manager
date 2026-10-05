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

  // 不应再有「自行实现地址归一化」的痕迹。
  // 判据用「协议判断正则」而不是简单的 `'http://' +`：
  // 拼接 http:// 也可能只是**构造给用户看的提示串**（例如把检测到的局域网 IP
  // 拼成示例地址），那不算重复实现归一化；真正的重复实现一定会先判断协议前缀。
  const dup = [];
  [['main.js', main], ['mobile/src/api.js', mobileApi], ['mobile/src/inboxDrop.js', mobileDrop]]
    .forEach(function (pair) {
      const src = pair[1];
      const hasProtoCheck = /\^https\?:\\\/\\\//.test(src) || /!\/\^https\?:/.test(src);
      // 归一化实现的另一个特征：去掉末尾斜杠
      const stripsSlash = /replace\(\/\\\/\+\$\/,\s*''\)/.test(src);
      if (hasProtoCheck && stripsSlash) dup.push(pair[0]);
    });
  assert.deepStrictEqual(dup, [],
    '这些文件看起来又自行实现了一份地址归一化（协议判断 + 去尾斜杠），应改用 shared 实现：' + dup.join(', '));
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

// ---------------- 地址与「安装主机」解耦（换机器/换网段后仍能用） ----------------
// 背景：同步地址跟着安装主机走 —— 换电脑、换路由器、DHCP 重新分配，网段和 IP 都会变。
// 所以：本机自连要用回环地址；手机上要能按网段自动找回电脑。

test('hostOf：从各种写法里取出主机名（不含端口）', function () {
  assert.strictEqual(Utils.hostOf('http://192.168.0.106:8787'), '192.168.0.106');
  assert.strictEqual(Utils.hostOf('192.168.1.6:8787'), '192.168.1.6', '漏写协议也要能解析');
  assert.strictEqual(Utils.hostOf('https://sync.example.com'), 'sync.example.com');
  assert.strictEqual(Utils.hostOf('http://[::1]:8787'), '::1', 'IPv6 方括号形式');
  assert.strictEqual(Utils.hostOf(''), '');
  assert.strictEqual(Utils.hostOf(null), '');
});

test('isLoopbackHost：认得出回环地址的各种写法', function () {
  assert.strictEqual(Utils.isLoopbackHost('127.0.0.1'), true);
  assert.strictEqual(Utils.isLoopbackHost('LOCALHOST'), true, '应忽略大小写');
  assert.strictEqual(Utils.isLoopbackHost('::1'), true);
  assert.strictEqual(Utils.isLoopbackHost('192.168.0.106'), false);
  assert.strictEqual(Utils.isLoopbackHost(''), false);
});

test('★ isSelfServerUrl：判断地址是否指向「本机自己」（决定要不要改用回环地址）', function () {
  const myIps = ['192.168.0.106'];
  assert.strictEqual(Utils.isSelfServerUrl('http://192.168.0.106:8787', myIps), true,
    '本机当前 IP → 是自己');
  assert.strictEqual(Utils.isSelfServerUrl('http://192.168.1.6:8787', ['192.168.1.6', '192.168.0.106']), true,
    '换成别的网段后，旧 IP 仍应被认作「曾经的自己」');
  assert.strictEqual(Utils.isSelfServerUrl('http://127.0.0.1:8787', myIps), true);
  assert.strictEqual(Utils.isSelfServerUrl('http://192.168.0.99:8787', myIps), false,
    '局域网里别人的地址不能误判为自己（否则会把人家的地址改掉）');
  assert.strictEqual(Utils.isSelfServerUrl('', myIps), false);
});

test('loopbackUrl：本机自连用回环地址，不受网段变化影响', function () {
  assert.strictEqual(Utils.loopbackUrl(8787), 'http://127.0.0.1:8787');
  assert.strictEqual(Utils.loopbackUrl(9000), 'http://127.0.0.1:9000');
  assert.strictEqual(Utils.loopbackUrl(), 'http://127.0.0.1:8787', '默认 8787');
});

test('subnetPrefix / subnetCandidates：生成同网段候选地址（自动查找电脑用）', function () {
  assert.strictEqual(Utils.subnetPrefix('192.168.0.106'), '192.168.0');
  assert.strictEqual(Utils.subnetPrefix('10.0.0.5'), '10.0.0');
  assert.strictEqual(Utils.subnetPrefix('192.168.0'), '', '只给三段不算完整 IP');
  assert.strictEqual(Utils.subnetPrefix('999.1.1.1'), '', '越界的段要拒绝');
  assert.strictEqual(Utils.subnetPrefix('bad'), '');

  // 前缀与完整 IP 两种写法都要能用
  assert.deepStrictEqual(
    Utils.subnetCandidates('192.168.0', 8787, { start: 1, end: 3 }),
    ['http://192.168.0.1:8787', 'http://192.168.0.2:8787', 'http://192.168.0.3:8787']
  );
  assert.deepStrictEqual(
    Utils.subnetCandidates('192.168.0.106', 8787, { start: 1, end: 3 }),
    ['http://192.168.0.1:8787', 'http://192.168.0.2:8787', 'http://192.168.0.3:8787']
  );
  assert.deepStrictEqual(
    Utils.subnetCandidates('192.168.0', 8787, { start: 1, end: 3, exclude: ['192.168.0.2'] }),
    ['http://192.168.0.1:8787', 'http://192.168.0.3:8787'],
    '应能排除指定地址（例如手机自己的 IP）'
  );
  assert.deepStrictEqual(Utils.subnetCandidates('nonsense', 8787), [], '非法前缀给空数组而不是抛错');
  assert.strictEqual(Utils.subnetCandidates('192.168.0', 8787).length, 254, '默认扫 1~254');
});

test('★ scanPrefixes：先试「上次成功的网段」，再退化到常见网段', function () {
  const list = Utils.scanPrefixes('http://192.168.1.6:8787');
  assert.strictEqual(list[0], '192.168.1', '上次成功的网段排最前，最可能命中');
  assert.ok(list.indexOf('192.168.0') >= 0, '常见网段作为换网络后的兜底');

  // 回环/空地址没有可用的网段信息，只返回常见网段
  const list2 = Utils.scanPrefixes('http://127.0.0.1:8787');
  assert.strictEqual(list2[0], '192.168.0', '回环地址没有网段信息，直接给常见网段');

  // 去重：常见网段里已有 192.168.0，不应重复出现
  const list3 = Utils.scanPrefixes('http://192.168.0.106:8787');
  assert.strictEqual(list3.filter(function (p) { return p === '192.168.0'; }).length, 1, '不应重复');
});
