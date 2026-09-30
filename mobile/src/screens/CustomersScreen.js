/**
 * CustomersScreen.js — 客户商机跟进（底部 Tab）。
 *
 * 手机是跟客户打交道时手边最近的设备，所以这一页围绕「今天的跟进」组织：
 *   - 顶部按「该跟进」分桶筛选（逾期 / 今天 / 本周 / 未安排），直接回答「今天该跟谁」
 *   - 每行显示阶段、下次跟进（超期标红）、金额（未落单显示预估、已赢单显示累计成交含增购）
 *   - 点行进详情页记录跟进 / 调整金额；右下角 ＋ 新建客户
 *
 * 金额与阶段语义完全复用 shared/customer.js（与桌面端同一套纯函数），
 * 保证「预估可调整」「落单才确认」「赢单后可增购」在两端行为一致。
 */
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { useSyncExternalStore } from 'react';
import store from '../store';
import shared from '../shared';

const { customer: CU, constants, sync, utils } = shared;
const DAY = 86400000;

const FILTERS = [
  { value: 'active', label: '推进中' },
  { value: 'overdue', label: '逾期' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'none', label: '未安排' },
  { value: 'all', label: '全部' },
];

function money(n) {
  const v = Number(n) || 0;
  if (v >= 10000) {
    const w = v / 10000;
    return '¥' + (w % 1 === 0 ? w : w.toFixed(2)) + '万';
  }
  return '¥' + v.toLocaleString('zh-CN');
}

export default function CustomersScreen({ navigation }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [filter, setFilter] = useState('active');
  const [keyword, setKeyword] = useState('');

  const all = store.getRecords(sync.ENTITY_TYPES.CUSTOMER);
  const followups = store.getRecords(sync.ENTITY_TYPES.FOLLOWUP);
  const now = Date.now();

  const buckets = CU.followupBuckets(all, followups, now);
  let list = all;
  if (filter === 'active') list = all.filter((c) => !CU.isClosed(c));
  else if (filter === 'all') list = all;
  else list = buckets[filter] || [];
  list = CU.searchCustomers(list, keyword);
  list = CU.sortCustomers(list, followups, now);

  const sum = CU.summarize(all);

  function followupText(c) {
    const next = CU.nextFollowupAt(c, followups);
    if (next == null) return { text: '尚未安排下次跟进', color: '#e0a030' };
    const diff = next - now;
    const days = Math.round(diff / DAY);
    if (diff < 0) return { text: '已超期 ' + Math.abs(days) + ' 天', color: '#e05b5b' };
    if (days === 0) return { text: '今天该跟进', color: '#e0a030' };
    if (days === 1) return { text: '明天跟进', color: '#e0a030' };
    return { text: days + ' 天后跟进 · ' + utils.toDateStr(next), color: '#666' };
  }

  function amountText(c) {
    const s = CU.amountSummary(c);
    if (s.hasDeal) {
      return {
        text: '成交 ' + money(s.won) + (s.upsellTotal ? '（含增购 ' + money(s.upsellTotal) + '）' : ''),
        color: '#4caf7d',
      };
    }
    if (s.expected) return { text: '预估 ' + money(s.expected) + '（未落单）', color: '#666' };
    return { text: '金额待确认', color: '#999' };
  }

  function renderItem({ item }) {
    const fu = followupText(item);
    const amt = amountText(item);
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('CustomerDetail', { id: item.id })}
      >
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name || '（未命名客户）'}
          </Text>
          <Text
            style={[
              styles.stageBadge,
              { backgroundColor: constants.CUSTOMER_STAGE_COLOR[item.stage] || '#8a8f98' },
            ]}
          >
            {constants.CUSTOMER_STAGE_LABEL[item.stage] || item.stage}
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {[item.contact, item.phone, item.owner ? '负责人 ' + item.owner : '']
            .filter(Boolean)
            .join(' · ') || '—'}
        </Text>
        <Text style={[styles.meta, { color: amt.color, marginTop: 4 }]}>{amt.text}</Text>
        <Text style={[styles.meta, { color: fu.color, marginTop: 4 }]}>{fu.text}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.statBar}>
        <Text style={styles.statText}>
          推进中 {sum.activeCount} · 在谈 {money(sum.expectedTotal)} · 累计成交 {money(sum.wonTotal)}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜客户 / 联系人 / 电话 / 负责人"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.filterScroll}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.value}
          renderItem={({ item: f }) => {
            const n =
              f.value === 'overdue' ? buckets.overdue.length
                : f.value === 'today' ? buckets.today.length
                  : f.value === 'week' ? buckets.week.length
                    : f.value === 'none' ? buckets.none.length
                      : null;
            return (
              <TouchableOpacity
                style={[styles.filterBtn, filter === f.value && styles.filterBtnActive]}
                onPress={() => setFilter(f.value)}
              >
                <Text style={[styles.filterText, filter === f.value && styles.filterTextActive]}>
                  {f.label}
                  {n != null ? ' ' + n : ''}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            没有符合条件的客户{'\n'}点右下角 ＋ 新建客户，或换个筛选条件
          </Text>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CustomerDetail', { create: true })}
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f5f6f8' },
  statBar: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e3e3e3',
  },
  statText: { fontSize: 12, color: '#555' },
  searchWrap: { backgroundColor: '#fff', paddingHorizontal: 12, paddingBottom: 8 },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  filterScroll: { backgroundColor: '#fff', paddingBottom: 8, paddingLeft: 12 },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 8,
    backgroundColor: '#f0f1f4',
  },
  filterBtnActive: { backgroundColor: '#4f8ef7' },
  filterText: { fontSize: 13, color: '#555' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  list: { padding: 12, paddingBottom: 90 },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 15, color: '#222', fontWeight: '600', flexShrink: 1 },
  stageBadge: {
    color: '#fff',
    fontSize: 11,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    overflow: 'hidden',
  },
  meta: { fontSize: 12, color: '#666', marginTop: 4 },
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
