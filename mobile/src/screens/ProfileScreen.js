/**
 * ProfileScreen.js — 我的页（底部 Tab 4）。
 *
 * 未登录：显示登录入口（跳 Login 模态页，用于与电脑端双向同步日程/待办）；
 * 已登录：展示账号 / 服务器地址 / 同步状态（最近同步时间、待推送变更数、错误信息），
 *         提供「立即同步」与「退出登录」。
 * 注：手机端「收集」页免登录即可用（离线收集 → 手动直传电脑收件箱）。
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSyncExternalStore } from 'react';
import store from '../store';
import syncClient from '../syncClient';
import formats from '../formats';

export default function ProfileScreen({ navigation }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const syncStatus = useSyncExternalStore(syncClient.subscribe, syncClient.getStatus);

  const user = store.getUser();
  const serverUrl = store.getServerUrl();
  const lastSyncAt = store.getLastSyncAt();
  const pending = store.getJournal().length;
  const inboxCfg = store.getInboxServer();
  const inboxPending = store.getPendingInboxCount();

  const stateText = syncStatus.inFlight
    ? '同步中…'
    : syncStatus.state === 'error'
    ? '同步出错'
    : '已就绪';
  const stateColor = syncStatus.state === 'error' ? '#e05b5b' : syncStatus.inFlight ? '#f2a541' : '#4caf7d';

  function confirmLogout() {
    Alert.alert('退出登录', '将清除本机缓存的账号与数据，确定退出？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: () => store.clearSession() },
    ]);
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      {!user ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>未登录</Text>
          <Text style={styles.cardSub}>
            登录后可与电脑端双向同步日程与待办。{'\n'}
            仅用「收集」页随手记不需要登录。
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.btnText}>登录 / 注册同步账号</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>账号</Text>
            <Text style={styles.cardValue}>{user.username}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>服务器</Text>
            <Text style={styles.cardValue}>{serverUrl || '未配置'}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>同步状态</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: stateColor }]} />
              <Text style={styles.cardValue}>{stateText}</Text>
            </View>
            <Text style={styles.cardSub}>上次同步：{formats.formatTs(lastSyncAt)}</Text>
            <Text style={styles.cardSub}>待推送变更：{pending} 条</Text>
            {syncStatus.lastError ? (
              <Text style={styles.errorText}>错误：{syncStatus.lastError}</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.btn, syncStatus.inFlight && styles.btnDisabled]}
            onPress={() => syncClient.syncNow()}
            disabled={syncStatus.inFlight}
          >
            {syncStatus.inFlight ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>立即同步</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* 收集直传状态（免登录功能，独立于同步账号） */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>收集直传</Text>
        <Text style={styles.cardSub}>
          {inboxCfg.url ? '电脑地址：' + inboxCfg.url : '未配置电脑地址'}
        </Text>
        <Text style={styles.cardSub}>待同步收集：{inboxPending} 条</Text>
        <Text style={styles.cardSub}>
          在「收集」页记录想法，回到电脑旁点「同步到电脑」即可送入电脑收件箱。
        </Text>
      </View>

      {user ? (
        <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={confirmLogout}>
          <Text style={styles.btnText}>退出登录</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f5f6f8' },
  container: { padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 12, color: '#888', marginBottom: 4 },
  cardValue: { fontSize: 16, color: '#222' },
  cardSub: { fontSize: 13, color: '#666', marginTop: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  errorText: { fontSize: 13, color: '#e05b5b', marginTop: 8 },
  btn: {
    backgroundColor: '#4f8ef7',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnDanger: { backgroundColor: '#e05b5b' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
