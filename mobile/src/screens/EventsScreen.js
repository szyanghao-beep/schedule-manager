/**
 * EventsScreen.js — 日程页（底部 Tab 1）。
 *
 * 按「选中日期」列出当天日程：对每条日程用 shared/utils.expandOccurrences
 * 展开重复实例（支持 daily/weekly/monthly + exceptions 例外），按开始时间排序；
 * 提供前一天 / 后一天 / 回到今天；支持新增（FAB）、编辑（点行）、
 * 删除（整系列，单次实例删除在表单里）、完成勾选。
 */
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSyncExternalStore } from 'react';
import store from '../store';
import shared from '../shared';
import formats from '../formats';

const { utils, constants, sync } = shared;
const { STATUS, STATUS_LABEL, PRIORITY_LABEL, REPEAT_LABEL, REPEAT_TYPE } = constants;

const STATUS_COLOR = {
  [STATUS.DONE]: '#8a8f98',
  [STATUS.OVERDUE]: '#e05b5b',
  [STATUS.DOING]: '#4f8ef7',
  [STATUS.PENDING]: '#4caf7d',
};
const PRIORITY_COLOR = { low: '#4caf7d', medium: '#f2a541', high: '#e05b5b' };

export default function EventsScreen({ navigation }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [day, setDay] = useState(() => utils.startOfDay(Date.now()));

  const events = store.getRecords(sync.ENTITY_TYPES.EVENT);
  const dayStart = utils.startOfDay(day);
  const dayEnd = utils.addDays(dayStart, 1);

  // 展开当天所有日程实例（重复日程按规则展开，exceptions 中被跳过的实例不会出现）
  const items = [];
  events.forEach((ev) => {
    utils.expandOccurrences(ev, { from: dayStart, to: dayEnd }).forEach((occ) => {
      items.push({ ev, occ });
    });
  });
  items.sort((a, b) => a.occ.startTime - b.occ.startTime);

  function repeatHint(ev) {
    const type = ev.repeat && ev.repeat.type;
    if (!type || type === REPEAT_TYPE.NONE) return null;
    return '🔁 ' + (REPEAT_LABEL[type] || type);
  }

  function confirmDelete(ev) {
    Alert.alert('删除日程', '确定删除该日程（整个系列）？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => store.deleteEvent(ev.id) },
    ]);
  }

  function renderItem({ item }) {
    const { ev, occ } = item;
    const now = Date.now();
    const status = utils.displayStatus(ev, now);
    const done = ev.status === STATUS.DONE;
    return (
      <View style={styles.row}>
        <TouchableOpacity style={styles.check} onPress={() => store.toggleEventDone(ev.id)}>
          <Text style={styles.checkText}>{done ? '✅' : '⬜'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rowBody}
          onPress={() => navigation.navigate('EventForm', { id: ev.id, occurrenceKey: occ.key })}
        >
          <View style={styles.rowTop}>
            <Text style={[styles.title, done && styles.titleDone]} numberOfLines={1}>
              {ev.title || '（无标题）'}
            </Text>
            {repeatHint(ev) ? <Text style={styles.repeat}>{repeatHint(ev)}</Text> : null}
          </View>
          <Text style={styles.time}>
            {ev.allDay ? '全天' : formats.timeRangeText(occ.startTime, occ.endTime)}
            {ev.categoryName ? '  ·  ' + ev.categoryName : ''}
          </Text>
          <View style={styles.metaRow}>
            {ev.priority ? (
              <Text style={[styles.badge, { backgroundColor: PRIORITY_COLOR[ev.priority] || '#888' }]}>
                {PRIORITY_LABEL[ev.priority]}
              </Text>
            ) : null}
            <Text style={[styles.badge, { backgroundColor: STATUS_COLOR[status] || '#888' }]}>
              {STATUS_LABEL[status] || status}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.delete} onPress={() => confirmDelete(ev)}>
          <Text style={styles.deleteText}>🗑</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.dateBar}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setDay(utils.addDays(day, -1))}>
          <Text style={styles.dateBtnText}>‹ 前一天</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDay(utils.startOfDay(Date.now()))}>
          <Text style={styles.dateLabel}>{formats.dateLabel(day)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setDay(utils.addDays(day, 1))}>
          <Text style={styles.dateBtnText}>后一天 ›</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.occ.key}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            这一天没有日程{'\n'}点击右下角 ＋ 新增
          </Text>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('EventForm', {})}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f5f6f8' },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  dateBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  dateBtnText: { color: '#4f8ef7', fontSize: 14 },
  dateLabel: { fontSize: 15, fontWeight: '600', color: '#222' },
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
  repeat: { fontSize: 11, color: '#8e6fd8', marginLeft: 6 },
  time: { fontSize: 12, color: '#666', marginTop: 4 },
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
