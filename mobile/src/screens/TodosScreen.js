/**
 * TodosScreen.js — 待办页（底部 Tab 2）。
 *
 * 列表按「未完成在前、截止时间升序（无截止时间排最后）」排序；
 * 每项显示四象限彩色徽标（utils.calcQuadrant + constants 的 QUADRANT_COLOR/LABEL，
 * 紧急阈值取自同步的 settings，缺省 24h）；
 * 支持完成勾选、全部/未完成/已完成筛选、新增（FAB）、编辑（点行）、删除。
 */
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSyncExternalStore } from 'react';
import store from '../store';
import shared from '../shared';
import formats from '../formats';
import QuadrantBadge from '../components/QuadrantBadge';

const { utils, constants, sync } = shared;
const { PRIORITY_LABEL, REPEAT_LABEL, REPEAT_TYPE, STATUS } = constants;

const PRIORITY_COLOR = { low: '#4caf7d', medium: '#f2a541', high: '#e05b5b' };
const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '未完成' },
  { value: 'done', label: '已完成' },
];

export default function TodosScreen({ navigation }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [filter, setFilter] = useState('all');

  const settings = store.getSettings();
  const urgentThresholdMs =
    ((settings && settings.urgentThresholdHours) || constants.URGENT_THRESHOLD_HOURS) * 3600 * 1000;
  const now = Date.now();

  let todos = store.getRecords(sync.ENTITY_TYPES.TODO);
  if (filter === 'pending') todos = todos.filter((t) => t.status !== STATUS.DONE);
  if (filter === 'done') todos = todos.filter((t) => t.status === STATUS.DONE);
  todos = todos.slice().sort((a, b) => {
    const ad = a.status === STATUS.DONE ? 1 : 0;
    const bd = b.status === STATUS.DONE ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const at = a.deadline == null ? Number.MAX_SAFE_INTEGER : a.deadline;
    const bt = b.deadline == null ? Number.MAX_SAFE_INTEGER : b.deadline;
    if (at !== bt) return at - bt;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  function repeatHint(t) {
    const type = t.repeat && t.repeat.type;
    if (!type || type === REPEAT_TYPE.NONE) return null;
    return '🔁 ' + (REPEAT_LABEL[type] || type);
  }

  function confirmDelete(t) {
    Alert.alert('删除待办', '确定删除该待办？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => store.deleteTodo(t.id) },
    ]);
  }

  function renderItem({ item }) {
    const done = item.status === STATUS.DONE;
    const quadrant = utils.calcQuadrant(item, now, urgentThresholdMs);
    return (
      <View style={styles.row}>
        <TouchableOpacity style={styles.check} onPress={() => store.toggleTodoDone(item.id)}>
          <Text style={styles.checkText}>{done ? '✅' : '⬜'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rowBody}
          onPress={() => navigation.navigate('TodoForm', { id: item.id })}
        >
          <View style={styles.rowTop}>
            <Text style={[styles.title, done && styles.titleDone]} numberOfLines={1}>
              {item.title || '（无标题）'}
            </Text>
            <QuadrantBadge quadrant={quadrant} />
          </View>
          <Text style={styles.meta}>
            {item.deadline ? '⏰ ' + formats.dateTimeToText(item.deadline) : '无截止时间'}
            {item.categoryName ? '  ·  ' + item.categoryName : ''}
          </Text>
          <View style={styles.metaRow}>
            {item.priority ? (
              <Text style={[styles.badge, { backgroundColor: PRIORITY_COLOR[item.priority] || '#888' }]}>
                {PRIORITY_LABEL[item.priority]}
              </Text>
            ) : null}
            {repeatHint(item) ? <Text style={styles.badgeGray}>{repeatHint(item)}</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.delete} onPress={() => confirmDelete(item)}>
          <Text style={styles.deleteText}>🗑</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterBtn, filter === f.value && styles.filterBtnActive]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.filterText, filter === f.value && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={todos}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            暂无待办{'\n'}点击右下角 ＋ 新增
          </Text>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('TodoForm', {})}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f5f6f8' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 8,
    backgroundColor: '#f0f1f4',
  },
  filterBtnActive: { backgroundColor: '#4f8ef7' },
  filterText: { fontSize: 13, color: '#555' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  list: { padding: 12, paddingBottom: 90 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  check: { paddingRight: 10 },
  checkText: { fontSize: 20 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, color: '#222', fontWeight: '500', flexShrink: 1 },
  titleDone: { color: '#999', textDecorationLine: 'line-through' },
  meta: { fontSize: 12, color: '#666', marginTop: 4 },
  metaRow: { flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' },
  badge: {
    color: '#fff',
    fontSize: 11,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    overflow: 'hidden',
  },
  badgeGray: {
    color: '#8e6fd8',
    fontSize: 11,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8e6fd8',
  },
  delete: { paddingLeft: 8 },
  deleteText: { fontSize: 16 },
  empty: { textAlign: 'center', color: '#999', marginTop: 60, lineHeight: 22 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#4f8ef7',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
