/**
 * LoginScreen.js — 登录 / 注册页。
 *
 * 可填写服务器地址（默认 http://<电脑局域网IP>:8787）、用户名、密码；
 * 支持登录 / 注册两种模式切换；
 * 成功后写入会话（store.setSession）并触发首次全量同步（syncNow，后台执行，不阻塞进入主界面）。
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import api from '../api';
import store from '../store';
import syncClient from '../syncClient';
import { findPc, testConnection } from '../findPc';

export default function LoginScreen({ navigation }) {
  // 预填上次用过的地址（退出登录不再清空），避免每次手输电脑 IP
  const [serverUrl, setServerUrl] = useState(store.getServerUrl() || api.DEFAULT_SERVER_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scanHint, setScanHint] = useState('');

  async function submit() {
    if (busy) return;
    const u = username.trim();
    if (!serverUrl.trim()) {
      setError('请填写电脑端地址（在电脑端「设置 → 本机同步服务」里查看局域网地址）');
      return;
    }
    if (!u || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res =
        mode === 'login'
          ? await api.login(serverUrl, u, password)
          : await api.register(serverUrl, u, password);
      store.setSession({ token: res.token, user: res.user, serverUrl });
      // 首次全量拉取（since=0），后台执行；结果在「我的」页可见
      syncClient.syncNow();
      // 登录页是模态页：成功后关闭，回到主界面
      if (navigation && navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      setError(e && e.message ? e.message : '网络错误，请检查服务器地址');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>日程管理</Text>
        <Text style={styles.subtitle}>React Native 安卓端 · 与桌面端数据同步</Text>

        <Text style={styles.label}>服务器地址</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="点「自动查找电脑」自动填入，或手输 IP:端口"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          填电脑端「设置 → 本机同步服务」中显示的地址（可省略 http://）。真机需与电脑连同一 Wi-Fi；安卓模拟器访问宿主机用 http://10.0.2.2:8787
        </Text>

        <TouchableOpacity
          style={styles.scanBtn}
          disabled={scanning}
          onPress={async () => {
            // 同步地址跟着电脑走：换电脑、换路由器后网段与 IP 都会变，
            // 所以与其让用户去查 IP（还容易写错网段），不如让手机自己找。
            setScanning(true);
            setError('');
            setScanHint('正在查找电脑…');
            try {
              const res = await findPc({
                lastGoodUrl: serverUrl || store.getServerUrl(),
                port: 8787,
                onProgress: function (p) {
                  setScanHint('正在查找… 已试 ' + p.scanned + '/' + p.total +
                    (p.prefix ? '（网段 ' + p.prefix + '.x）' : ''));
                },
              });
              if (res.url) {
                setServerUrl(res.url);
                setScanHint('已找到电脑：' + res.url);
              } else {
                setScanHint('没找到电脑：请确认电脑上已启用「本机同步服务」，且手机与电脑连的是同一个 WiFi。');
              }
            } catch (e) {
              setScanHint('查找失败：' + (e && e.message ? e.message : e));
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
            // 把「连不上」与「这个地址上不是本程序」分开说清楚
            setTesting(true);
            setScanHint('正在测试连接…');
            try {
              const r = await testConnection(serverUrl || store.getServerUrl());
              setScanHint((r.ok ? '✅ ' : '❌ ') + r.message);
            } catch (e) {
              setScanHint('测试失败：' + (e && e.message ? e.message : e));
            } finally {
              setTesting(false);
            }
          }}
        >
          <Text style={styles.scanBtnText}>{testing ? '测试中…' : '测试连接'}</Text>
        </TouchableOpacity>
        {scanHint ? <Text style={styles.hint}>{scanHint}</Text> : null}

        <Text style={styles.label}>用户名</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="用户名"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>密码</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="密码"
          secureTextEntry
        />

        <View style={styles.modeRow}>
          {['login', 'register'].map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                {m === 'login' ? '登录' : '注册'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.submit, busy && styles.submitDisabled]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{mode === 'login' ? '登 录' : '注 册'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 6, marginBottom: 28 },
  label: { fontSize: 13, color: '#555', marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  hint: { fontSize: 11, color: '#999', marginTop: 6 },
  modeRow: { flexDirection: 'row', marginTop: 20, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#4f8ef7' },
  modeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#fff' },
  modeBtnActive: { backgroundColor: '#4f8ef7' },
  modeText: { fontSize: 14, color: '#4f8ef7' },
  modeTextActive: { color: '#fff', fontWeight: '600' },
  error: { color: '#e05b5b', marginTop: 12, fontSize: 13 },
  scanBtn: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#4f8ef7',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  scanBtnText: { color: '#4f8ef7', fontSize: 14, fontWeight: '600' },
  submit: {
    marginTop: 24,
    backgroundColor: '#4f8ef7',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
