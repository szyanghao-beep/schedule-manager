/*
 * mobile.contract.test.js — 手机端（React Native）接线契约测试
 *
 * 背景：手机端无法在 CI 里跑真实的安卓构建，过去出过「代码看着对、一跑就崩」的问题
 * （例如桌面端 preload 暴露了方法但 api.js 漏透传，整页渲染中断）。
 * 手机端同类风险很高：
 *   - 屏幕里 store.xxx() 调了 store 没导出的方法
 *   - navigation.navigate('X') 指向没注册的 Stack.Screen
 *   - App.js import 了不存在的屏幕文件
 *   - 屏幕里用了 shared / constants 里不存在的字段
 * 这些都能在纯 Node 下静态查出来，不必等打包到手机上才发现。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); };

// 收集手机端所有屏幕与组件源码
function mobileSources() {
  const out = [];
  ['src/screens', 'src/components', 'src'].forEach(function (dir) {
    const full = path.join(MOBILE, dir);
    if (!fs.existsSync(full)) return;
    fs.readdirSync(full).forEach(function (name) {
      const rel = path.join(dir, name).replace(/\\/g, '/');
      const abs = path.join(MOBILE, rel);
      if (fs.statSync(abs).isFile() && name.endsWith('.js')) out.push('mobile/' + rel);
    });
  });
  return Array.from(new Set(out));
}

// 解析 store.js 的 export default { ... } 里列出的方法名
function storeExports() {
  const src = read('mobile/src/store.js');
  const start = src.indexOf('export default {');
  assert.ok(start > 0, '应能定位 mobile/src/store.js 的导出块');
  const body = src.slice(start);
  const names = [];
  const re = /(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*[,}]/gm;
  let m;
  while ((m = re.exec(body)) !== null) names.push(m[1]);
  return Array.from(new Set(names));
}

test('手机端调用的 store.xxx 都在 mobile/src/store.js 中导出（防调用不存在的方法）', function () {
  const exported = storeExports();
  assert.ok(exported.length > 20, '应解析出 store 的导出方法（实际 ' + exported.length + ' 个）');

  const bad = [];
  mobileSources().forEach(function (f) {
    if (f === 'mobile/src/store.js') return;
    const src = read(f);
    const re = /\bstore\.([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (exported.indexOf(m[1]) < 0) bad.push(f + ' -> store.' + m[1]);
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    '屏幕调用了 store 未导出的方法：\n  ' + Array.from(new Set(bad)).join('\n  '));
});

test('手机端 navigation.navigate 的目标都有对应的 Stack.Screen 注册（防跳到不存在的页面）', function () {
  const app = read('mobile/App.js');
  const registered = [];
  const reReg = /<Stack\.Screen\s+name="([^"]+)"/g;
  let m;
  while ((m = reReg.exec(app)) !== null) registered.push(m[1]);
  assert.ok(registered.length >= 4, '应解析出已注册的路由（实际 ' + registered.length + ' 个）');

  const bad = [];
  mobileSources().forEach(function (f) {
    const src = read(f);
    const re = /navigation\.navigate\(\s*'([^']+)'/g;
    let m2;
    while ((m2 = re.exec(src)) !== null) {
      if (registered.indexOf(m2[1]) < 0) bad.push(f + ' -> ' + m2[1]);
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    '跳转目标没有注册 Stack.Screen：\n  ' + Array.from(new Set(bad)).join('\n  ') +
    '\n已注册：' + registered.join(', '));
});

test('App.js 里 import 的屏幕文件都真实存在', function () {
  const app = read('mobile/App.js');
  const re = /import\s+\w+\s+from\s+'\.\/(src\/[^']+)'/g;
  const missing = [];
  let m;
  while ((m = re.exec(app)) !== null) {
    const rel = 'mobile/' + m[1];
    const candidates = [rel, rel + '.js'];
    if (!candidates.some(function (c) { return fs.existsSync(path.join(ROOT, c)); })) missing.push(rel);
  }
  assert.deepStrictEqual(missing, [], 'App.js 引用了不存在的文件：' + missing.join(', '));
});

test('手机端用到的 shared 子模块都存在（防写成 shared.xxx 但入口没导出）', function () {
  const sharedIndex = require(path.join(ROOT, 'shared', 'index.js'));
  const available = Object.keys(sharedIndex);

  const bad = [];
  mobileSources().forEach(function (f) {
    const src = read(f);
    // 形如 const { customer: CU, constants, sync } = shared;
    const re = /const\s*\{([^}]+)\}\s*=\s*shared\s*;/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      m[1].split(',').forEach(function (part) {
        const key = part.split(':')[0].trim();
        if (key && available.indexOf(key) < 0) bad.push(f + ' -> shared.' + key);
      });
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    'shared 入口没有这些子模块：' + Array.from(new Set(bad)).join(', ') + '（可用：' + available.join(', ') + '）');
});

test('手机端用到的 constants.XXX 都在 shared/constants.js 中真实存在', function () {
  const constants = require(path.join(ROOT, 'shared', 'constants.js'));

  const bad = [];
  mobileSources().forEach(function (f) {
    const src = read(f);
    const re = /\bconstants\.([A-Z][A-Z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!Object.prototype.hasOwnProperty.call(constants, m[1])) bad.push(f + ' -> constants.' + m[1]);
    }
  });
  assert.deepStrictEqual(Array.from(new Set(bad)), [],
    '引用了不存在的常量：' + Array.from(new Set(bad)).join(', '));
});

test('手机端按权限隐藏 Tab（与桌面端同一套规则，未登录不限制）', function () {
  const app = read('mobile/App.js');
  const storeSrc = read('mobile/src/store.js');

  // store 侧必须提供角色/权限派生（未登录返回 null = 不限制）
  assert.ok(/function getPermissions/.test(storeSrc), 'store 应导出 getPermissions');
  assert.ok(/function canAccess/.test(storeSrc), 'store 应提供 canAccess');
  assert.ok(/if \(!state\.token\) return null;/.test(storeSrc),
    '未登录时 getPermissions 应返回 null（纯本地使用不受权限限制）');

  // App 侧必须按权限决定三个功能 Tab 是否渲染
  ['schedule', 'todo', 'customer'].forEach(function (key) {
    assert.ok(
      app.indexOf("allowed('" + key + "')") >= 0,
      'App.js 应通过 allowed(\'' + key + '\') 控制该 Tab 的可见性'
    );
  });

  // 「收集」与「我的」必须无条件保留：
  // 收集是免登录的离线随手记；我的里面有登录/账号入口，藏掉就等于把人锁在门外
  assert.ok(/<Tab\.Screen\s+name="Collect"/.test(app), '「收集」Tab 应始终存在');
  assert.ok(/<Tab\.Screen\s+name="Profile"/.test(app), '「我的」Tab 应始终存在');
  assert.ok(!/allowed\('(collect|profile)'\)/.test(app),
    '「收集」「我的」不应受权限控制');
});

test('安卓端 versionName 与发布版本一致（防两端版本漂移）', function () {
  // 安卓 APK 的版本号曾经长期停在 versionCode 1 / versionName "1.0"：
  // 装上去看不出版本、系统也不提示更新，用户无法判断自己装的是哪一版。
  // APK 是跟着发布版本一起发的，所以两者必须一致。
  const gradle = read('mobile/android/app/build.gradle');
  const nameMatch = /versionName\s+"([^"]+)"/.exec(gradle);
  const codeMatch = /versionCode\s+(\d+)/.exec(gradle);
  assert.ok(nameMatch, '应能从 mobile/android/app/build.gradle 解析出 versionName');
  assert.ok(codeMatch, '应能从 mobile/android/app/build.gradle 解析出 versionCode');

  const pkgVersion = require(path.join(ROOT, 'package.json')).version;
  assert.strictEqual(
    nameMatch[1], pkgVersion,
    '安卓 versionName（' + nameMatch[1] + '）应与 package.json 版本（' + pkgVersion +
    '）一致；发新版时两者都要改'
  );

  const code = Number(codeMatch[1]);
  assert.ok(Number.isInteger(code) && code >= 1, 'versionCode 应是 ≥1 的整数，实际 ' + codeMatch[1]);
});

test('安卓 APK 会随 Release 一起发布（不能只作为 Actions artifact）', function () {
  // artifact 需要登录 GitHub 才能下载、且 90 天过期；
  // 用户是从 Release 页取安装包的，所以 APK 必须进 Release。
  const build = read('.github/workflows/build.yml');
  assert.ok(/android:/.test(build), 'build.yml 应有 android job 构建 APK');
  assert.ok(
    /needs:\s*\[[^\]]*android[^\]]*\]/.test(build),
    'release job 的 needs 里应包含 android，否则 APK 不会进 Release'
  );
  assert.ok(
    /assembleRelease/.test(build),
    'android job 应用 assembleRelease 构建（debug 版不打包 JS bundle，装上去会红屏）'
  );
  // tag 触发的工作流用的是该 tag 所指提交里的 workflow 文件，
  // 所以 release job 里必须清理陈旧资产，保证重跑幂等（否则改名后新旧两套并存）
  assert.ok(
    /cleanup|清理/.test(build) && /releases\/assets\//.test(build),
    'release job 应在上传后清理陈旧资产以保证重跑幂等；' +
    '且必须按「资产 id」删除（gh api -X DELETE .../releases/assets/<id>）——' +
    '陈旧资产名可能以 "-" 开头（中文被 GitHub 剥掉后就是 -2.3.4.dmg），' +
    '把名字当参数传给 gh 会被当成命令行选项而报错'
  );
  assert.ok(
    !/gh release delete-asset/.test(build),
    '不要用 gh release delete-asset（按名字传参，遇到以 - 开头的资产名会失败）'
  );
  // 清理属收尾工作，产物此时已发布成功，不该因它把整次发布判为失败
  // （实际踩过：android/mac/win/test 全 success、产物也传上去了，只因清理步骤
  //  报错就让 release job 变红，看起来像「发布失败」）
  const cleanupStep = build.slice(build.indexOf('清理不在本次产物清单里'));
  assert.ok(
    /continue-on-error:\s*true/.test(cleanupStep.slice(0, 200)) && /set \+e/.test(build),
    '清理步骤应设 continue-on-error 并在脚本里 set +e，避免收尾失败让发布被判失败'
  );

  // 结构自检：六个 job 都要在（2 空格缩进的顶层键），防误删/改名后静默失效。
  // 注：这里只做轻量结构检查；完整的 YAML 合法性靠 push 前人工用解析器验证
  // （格式错会导致整条流水线不触发，比 job 失败更隐蔽）。
  ['test', 'server-test', 'mac', 'win', 'android', 'release'].forEach(function (j) {
    assert.ok(
      new RegExp('(^|\\n) {2}' + j + ':').test(build),
      'build.yml 缺少 job：' + j
    );
  });
});
