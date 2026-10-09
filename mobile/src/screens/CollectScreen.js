/**
 * CollectScreen.js — 「收集」页（手机端离线收集 → 手动同步到电脑收件箱）。
 *
 * 特点：
 *   - 免登录：随手记待办/想法，不依赖账号；
 *   - 离线可用：只写本地（AsyncStorage），不自动联网；
 *   - 手动直传：回到电脑旁点「同步到电脑」，把未同步条目一次性投递到电脑收件箱；
 *   - 连续录入：记完一条自动清空输入框，方便一口气倒出多个想法。
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSyncExternalStore } from 'react';
import store from '../store';
import inboxDrop from '../inboxDrop';
import formats from '../formats';
import { findPc, testConnection } from '../findPc';

export default function CollectScreen() {
  useSyncExternalStore(store.subscribe, store.getSnapshot);

  const cfg0 = store.getInboxServer();
  const [text, setText] = useState('');
  const [showConfig, setShowConfig] = useState(!cfg0.url);
  const [url, setUrl] = useState(cfg0.url);
  const [code, setCode] = useState(cfg0.code);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState('');

  const items = store.getLocalInbox();
  const pendingCount = store.getPendingInboxCount();

  function add() {
    const t = text.trim();
    if (!t) return;
    store.addInboxItem(t);
    setText(''); // 清空，方便连续录入
  }

  function saveConfig() {
    store.setInboxServer(url, code);
    setShowConfig(false);
    setStatus('配置已保存');
  }

  function removeItem(item) {
    Alert.alert('删除', '删除这条收集？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => store.removeInboxItem(item.id) },
    ]);
  }

  async function syncNow() {
    const cfg = store.getInboxServer();
    if (!cfg.url || !cfg.code) {
      setShowConfig(true);
      setStatus('请先填写电脑地址与收集口令');
      return;
    }
    const pending = store.getPendingInbox();
    if (!pending.length) {
      setStatus('没有待同步的条目');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await inboxDrop.ping(cfg.url); // 先探测连通性，错误提示更明确
      const res = await inboxDrop.dropToPc(cfg.url, cfg.code, pending);
      store.markInboxSynced(pending.map((it) => it.id));
      setStatus(
        '已同步 ' + res.accepted + ' 条到电脑收件箱' +
        (res.duplicated ? '（其中 ' + res.duplicated + ' 条电脑上已存在）' : '')
      );
    } catch (e) {
      setStatus('同步失败：' + (e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  function renderItem({ item }) {
    return (
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowMeta}>
            {formats.formatTs(item.createdAt)} · {item.synced ? '已同步' : '待同步'}
          </Text>
        </View>
        <TouchableOpacity style={styles.rowDel} onPress={() => removeItem(item)}>
          <Text style={styles.rowDelText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>收集箱</Text>
        <TouchableOpacity onPress={() => setShowConfig(!showConfig)}>
          <Text style={styles.configBtn}>{showConfig ? '收起设置' : '⚙ 连接设置'}</Text>
        </TouchableOpacity>
      </View>

      {showConfig ? (
        <View style={styles.configBox}>
          <Text style={styles.label}>电脑端地址（电脑「设置 → 本机同步服务」里有）</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="点「自动查找电脑」自动填入，或手输 IP:端口"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.label}>收集口令（6 位，电脑设置页显示）</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="例如 123456"
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity
            style={styles.scanBtn}
            disabled={scanning}
            onPress={async () => {
              // 自动查找：同步地址跟着电脑走（换电脑/换路由器后网段会变），
              // 与其让用户去查 IP、还容易写错网段，不如自己去找。
              setScanning(true);
              setStatus('正在查找电脑…');
              try {
                const res = await findPc({
                  lastGoodUrl: url || cfg0.url,
                  port: 8787,
                  onProgress: function (p) {
                    setStatus('正在查找电脑… 已试 ' + p.scanned + '/' + p.total +
                      (p.prefix ? '（网段 ' + p.prefix + '.x）' : ''));
                  },
                });
                if (res.url) {
                  setUrl(res.url);
                  setStatus('已找到电脑：' + res.url + '，请确认口令后保存');
                } else {
                  setStatus('没找到电脑。请确认：① 电脑上已启用「本机同步服务」；② 手机与电脑连同一个 WiFi。' +
                    '也可以直接在电脑「设置 → 本机同步服务」里看地址后手输。');
                }
              } catch (e) {
                setStatus('查找失败：' + (e && e.message ? e.message : e));
              } finally {
                setScanning(false);
              }
            }}
          >
            <Text style={styles.scanBtnText}>{scanning ? '查找中…' : '🔍 自动查找电脑'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.scanBtn}
            disabled={testing}
            onPress={async () => {
              // 「测试连接」把「连不上」与「这个地址上不是本程序」分开说清楚 ——
              // 否则用户只看到 Network request failed，完全不知道该改什么。
              setTesting(true);
              setStatus('正在测试连接…');
              try {
                const r = await testConnection(url);
                setStatus((r.ok ? '✅ ' : '❌ ') + r.message);
              } catch (e) {
                setStatus('测试失败：' + (e && e.message ? e.message : e));
              } finally {
                setTesting(false);
              }
            }}
          >
            <Text style={styles.scanBtnText}>{testing ? '测试中…' : '测试连接'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={saveConfig}>
            <Text style={styles.saveBtnText}>保存设置</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            提示：手机需与电脑连同一个 WiFi；电脑端在「设置 → 本机同步服务」启用后即可接收。
            电脑换网络后地址会变，用「自动查找电脑」最省事。
          </Text>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.capture}
          value={text}
          onChangeText={setText}
          placeholder="随手记一条待办或想法…"
          multiline
          blurOnSubmit={false}
          onSubmitEditing={add}
        />
        <TouchableOpacity style={[styles.addBtn, !text.trim() && styles.addBtnOff]} onPress={add}>
          <Text style={styles.addBtnText}>收下</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listHead}>
        <Text style={styles.listHeadText}>
          共 {items.length} 条{ pendingCount ? ' · 待同步 ' + pendingCount + ' 条' : ' · 全部已同步' }
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>还没有收集内容{'\n'}在上面输入框记一条试试</Text>}
      />

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <TouchableOpacity
        style={[styles.syncBtn, busy && styles.syncBtnBusy]}
        onPress={syncNow}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.syncBtnText}>
            {pendingCount ? '同步到电脑（' + pendingCount + ' 条）' : '同步到电脑'}
          </Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f5f6f8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 50 : 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  configBtn: { fontSize: 13, color: '#4f8ef7' },
  configBox: { backgroundColor: '#fff', paddingHorizontal: 14, paddingBottom: 12 },
  label: { fontSize: 12, color: '#666', marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  scanBtn: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#4f8ef7',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  scanBtnText: { color: '#4f8ef7', fontSize: 14, fontWeight: '600' },
  saveBtn: {
    marginTop: 12,
    backgroundColor: '#4f8ef7',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '600' },
  hint: { fontSize: 11, color: '#999', marginTop: 8, lineHeight: 16 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e4e6ea',
  },
  capture: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  addBtn: {
    marginLeft: 8,
    backgroundColor: '#4f8ef7',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addBtnOff: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  listHead: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  listHeadText: { fontSize: 12, color: '#888' },
  list: { paddingHorizontal: 12, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, color: '#222' },
  rowMeta: { fontSize: 11, color: '#999', marginTop: 4 },
  rowDel: { paddingLeft: 10, paddingVertical: 4 },
  rowDelText: { fontSize: 16, color: '#c0c4cc' },
  empty: { textAlign: 'center', color: '#999', marginTop: 40, lineHeight: 22 },
  status: { paddingHorizontal: 14, paddingBottom: 6, fontSize: 12, color: '#4f8ef7' },
  syncBtn: {
    margin: 12,
    backgroundColor: '#4f8ef7',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  syncBtnBusy: { opacity: 0.7 },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
