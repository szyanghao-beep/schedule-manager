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

export default function LoginScreen() {
  const [serverUrl, setServerUrl] = useState(api.DEFAULT_SERVER_URL);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (busy) return;
    const u = username.trim();
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
          placeholder="http://192.168.1.100:8787"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          提示：真机填电脑局域网 IP（同一 Wi-Fi）；安卓模拟器访问宿主机用 http://10.0.2.2:8787
        </Text>

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
