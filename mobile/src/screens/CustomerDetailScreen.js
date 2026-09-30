/**
 * CustomerDetailScreen.js — 客户详情 / 新建 / 记录跟进 / 金额流转（模态页）。
 *
 * 路由参数：
 *   { id }     查看并编辑已有客户
 *   { create } 新建客户
 *
 * 金额区块刻意不做成「一个金额输入框」，而是与桌面端一致的四个派生值：
 *   当前预估 / 落单确认 / 增购累计 / 累计成交
 * 因为真实业务是「先有个预估，落单才能确认，之后增购还会往上加」，
 * 单字段会被反复覆盖、丢掉过程。
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSyncExternalStore } from 'react';
import store from '../store';
import shared from '../shared';
import formats from '../formats';

const { customer: CU, constants, sync } = shared;
const DAY = 86400000;

function money(n) {
  const v = Number(n) || 0;
  if (v >= 10000) {
    const w = v / 10000;
    return '¥' + (w % 1 === 0 ? w : w.toFixed(2)) + '万';
  }
  return '¥' + v.toLocaleString('zh-CN');
}

export default function CustomerDetailScreen({ route, navigation }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const params = route.params || {};
  const isCreate = !!params.create;
  const id = params.id;

  const existing = id ? store.getById(sync.ENTITY_TYPES.CUSTOMER, id) : null;

  const [name, setName] = useState(existing ? existing.name || '' : '');
  const [contact, setContact] = useState(existing ? existing.contact || '' : '');
  const [phone, setPhone] = useState(existing ? existing.phone || '' : '');
  const [owner, setOwner] = useState(existing ? existing.owner || '' : '');
  const [remark, setRemark] = useState(existing ? existing.remark || '' : '');

  // 新建模式只显示资料表单
  if (isCreate || !existing) {
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
        <Text style={styles.sectionTitle}>{isCreate ? '新建客户' : '客户已不存在'}</Text>
        {isCreate ? (
          <View>
            <Text style={styles.label}>客户 / 公司名称 *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="必填" />
            <Text style={styles.label}>联系人</Text>
            <TextInput style={styles.input} value={contact} onChangeText={setContact} />
            <Text style={styles.label}>联系电话</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Text style={styles.label}>负责人</Text>
            <TextInput
              style={styles.input}
              value={owner}
              onChangeText={setOwner}
              placeholder="团队共用时建议统一写法，便于筛选"
            />
            <Text style={styles.label}>备注</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={remark}
              onChangeText={setRemark}
              multiline
            />
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                if (!name.trim()) {
                  Alert.alert('提示', '请填写客户名称');
                  return;
                }
                store.createCustomer({
                  name: name.trim(),
                  contact: contact.trim(),
                  phone: phone.trim(),
                  owner: owner.trim(),
                  remark: remark.trim(),
                });
                navigation.goBack();
              }}
            >
              <Text style={styles.primaryBtnText}>保存</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>返回</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  const followups = store
    .getFollowups(existing.id)
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const sum = CU.amountSummary(existing);
  const next = CU.nextFollowupAt(existing, store.getFollowups(existing.id));
  const history = (existing.amountHistory || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));

  function saveProfile() {
    store.updateCustomer(existing.id, {
      name: name.trim() || existing.name,
      contact: contact.trim(),
      phone: phone.trim(),
      owner: owner.trim(),
      remark: remark.trim(),
    });
    Alert.alert('已保存', '客户资料已更新');
  }

  // 记录跟进：走一个轻量输入流程（用 Alert.prompt 在安卓上不可用，故用页面内联表单）
  const [fuOpen, setFuOpen] = useState(false);
  const [fuContent, setFuContent] = useState('');
  const [fuPlan, setFuPlan] = useState('');
  const [fuDays, setFuDays] = useState('3');
  const [fuMethod, setFuMethod] = useState('phone');
  const [amtOpen, setAmtOpen] = useState(false);
  const [amtKind, setAmtKind] = useState('estimate');
  const [amtValue, setAmtValue] = useState('');
  const [amtNote, setAmtNote] = useState('');

  function submitFollowup() {
    const days = Number(fuDays);
    if (!isFinite(days) || days <= 0) {
      Alert.alert('提示', '请填写下次跟进天数（这是不遗漏跟进的关键）');
      return;
    }
    const nextAt = Date.now() + days * DAY;
    const res = store.recordFollowup(existing.id, {
      method: fuMethod,
      content: fuContent.trim(),
      nextAt: nextAt,
      nextPlan: fuPlan.trim(),
    });
    if (!res) {
      Alert.alert('保存失败', '请重试');
      return;
    }
    setFuOpen(false);
    setFuContent('');
    setFuPlan('');
    Alert.alert(
      '已记录跟进',
      '下次跟进 ' + formats.dateTimeToText(nextAt) + '\n已自动生成一条待办，到点会提醒。'
    );
  }

  function submitAmount() {
    const v = Number(amtValue);
    if (!isFinite(v) || v < 0 || amtValue === '') {
      Alert.alert('提示', '请填写有效金额');
      return;
    }
    const r = store.addCustomerAmount(existing.id, {
      kind: amtKind,
      amount: v,
      note: amtNote.trim(),
    });
    if (!r) {
      Alert.alert('保存失败', amtKind === 'upsell' ? '仅赢单后可追加增购' : '落单金额只能确认一次');
      return;
    }
    setAmtOpen(false);
    setAmtValue('');
    setAmtNote('');
    Alert.alert('已记录', constants.AMOUNT_KIND_LABEL[amtKind] + ' ' + money(v));
  }

  function changeStage(stage) {
    if (stage === existing.stage) return;
    if (stage === 'won' && !sum.hasDeal) {
      // 落单才确认成交金额：未落单就切赢单，必须先填成交额
      setAmtKind('deal');
      setAmtValue(String(sum.expected || ''));
      setAmtOpen(true);
      Alert.alert('确认成交金额', '赢单需要先确认成交金额，填好后点保存即可完成落单。');
      return;
    }
    store.updateCustomer(existing.id, { stage: stage });
  }

  function confirmDelete() {
    Alert.alert('删除客户', '确定删除「' + existing.name + '」？其跟进记录与未完成的跟进待办会一并删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          store.deleteCustomer(existing.id);
          navigation.goBack();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <View style={styles.headRow}>
        <Text style={styles.name}>{existing.name || '（未命名客户）'}</Text>
        <Text
          style={[
            styles.stageBadge,
            { backgroundColor: constants.CUSTOMER_STAGE_COLOR[existing.stage] || '#8a8f98' },
          ]}
        >
          {constants.CUSTOMER_STAGE_LABEL[existing.stage] || existing.stage}
        </Text>
      </View>

      {/* 下次跟进 —— 手机上看这一页最想知道的信息 */}
      <View style={styles.nextCard}>
        <Text style={styles.nextLabel}>下次跟进</Text>
        <Text
          style={[
            styles.nextValue,
            {
              color:
                next == null
                  ? '#e0a030'
                  : next < Date.now()
                    ? '#e05b5b'
                    : next - Date.now() < DAY
                      ? '#e0a030'
                      : '#333',
            },
          ]}
        >
          {next == null ? '尚未安排（点下方「记录跟进」安排）' : formats.dateTimeToText(next)}
        </Text>
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setFuOpen(!fuOpen)}>
          <Text style={styles.primaryBtnText}>{fuOpen ? '收起' : '记录跟进'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            setAmtKind(sum.hasDeal ? 'upsell' : 'estimate');
            setAmtOpen(!amtOpen);
          }}
        >
          <Text style={styles.secondaryBtnText}>{amtOpen ? '收起金额' : '金额'}</Text>
        </TouchableOpacity>
      </View>

      {fuOpen ? (
        <View style={styles.formCard}>
          <Text style={styles.label}>跟进方式</Text>
          <View style={styles.chipRow}>
            {constants.FOLLOWUP_METHODS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.chip, fuMethod === m && styles.chipActive]}
                onPress={() => setFuMethod(m)}
              >
                <Text style={[styles.chipText, fuMethod === m && styles.chipTextActive]}>
                  {(constants.FOLLOWUP_METHOD_ICON[m] || '') + ' ' + constants.FOLLOWUP_METHOD_LABEL[m]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>本次跟进内容</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={fuContent}
            onChangeText={setFuContent}
            placeholder="聊了什么、客户关心什么"
            multiline
          />
          <Text style={styles.label}>下次跟进（几天后）*</Text>
          <TextInput
            style={styles.input}
            value={fuDays}
            onChangeText={setFuDays}
            keyboardType="number-pad"
            placeholder="如 3"
          />
          <Text style={styles.label}>下次跟进计划</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={fuPlan}
            onChangeText={setFuPlan}
            placeholder="下次要谈什么"
            multiline
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={submitFollowup}>
            <Text style={styles.primaryBtnText}>保存并安排下次提醒</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {amtOpen ? (
        <View style={styles.formCard}>
          <Text style={styles.label}>金额类型</Text>
          <View style={styles.chipRow}>
            {[
              { k: 'estimate', label: '调整预估' },
              { k: 'deal', label: '落单确认' },
              { k: 'upsell', label: '追加增购' },
            ].map((opt) => {
              const disabled = (opt.k === 'upsell' && !CU.canUpsell(existing)) || (opt.k === 'deal' && sum.hasDeal);
              return (
                <TouchableOpacity
                  key={opt.k}
                  disabled={disabled}
                  style={[styles.chip, amtKind === opt.k && styles.chipActive, disabled && styles.chipDisabled]}
                  onPress={() => setAmtKind(opt.k)}
                >
                  <Text style={[styles.chipText, amtKind === opt.k && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>
            {amtKind === 'estimate'
              ? '预估可反复调整，历史会保留；未落单前列表显示预估。'
              : amtKind === 'deal'
                ? '落单金额只确认一次，之后要加请用「追加增购」。'
                : '增购会累加到该客户的累计成交额。'}
          </Text>
          <Text style={styles.label}>金额（元）</Text>
          <TextInput
            style={styles.input}
            value={amtValue}
            onChangeText={setAmtValue}
            keyboardType="numeric"
            placeholder="0"
          />
          <Text style={styles.label}>备注（可选）</Text>
          <TextInput style={styles.input} value={amtNote} onChangeText={setAmtNote} />
          <TouchableOpacity style={styles.primaryBtn} onPress={submitAmount}>
            <Text style={styles.primaryBtnText}>保存金额</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 金额：四个派生值 + 流水留痕 */}
      <Text style={styles.sectionTitle}>金额</Text>
      <View style={styles.card}>
        <Text style={styles.kv}>当前预估：{money(sum.expected)}</Text>
        <Text style={styles.kv}>落单确认：{sum.hasDeal ? money(sum.deal) : '未落单'}</Text>
        <Text style={styles.kv}>增购累计：{money(sum.upsellTotal)}</Text>
        <Text style={[styles.kv, styles.kvStrong]}>累计成交：{money(sum.won)}</Text>
        {history.length ? (
          <View style={{ marginTop: 6 }}>
            {history.map((h) => (
              <Text key={h.at + '-' + h.kind + '-' + h.amount} style={styles.historyLine}>
                {formats.dateTimeToText(h.at)} · {constants.AMOUNT_KIND_LABEL[h.kind] || h.kind}{' '}
                {money(h.amount)}
                {h.note ? '（' + h.note + '）' : ''}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {/* 阶段推进 */}
      <Text style={styles.sectionTitle}>阶段</Text>
      <View style={styles.chipRow}>
        {constants.CUSTOMER_STAGES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, existing.stage === s && styles.chipActive]}
            onPress={() => changeStage(s)}
          >
            <Text style={[styles.chipText, existing.stage === s && styles.chipTextActive]}>
              {constants.CUSTOMER_STAGE_LABEL[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 跟进时间线 */}
      <Text style={styles.sectionTitle}>跟进记录（{followups.length}）</Text>
      {followups.length === 0 ? (
        <Text style={styles.hint}>还没有跟进记录，点上方「记录跟进」写第一次。</Text>
      ) : (
        followups.map((f) => (
          <View key={f.id} style={styles.card}>
            <Text style={styles.fuTitle}>
              {(constants.FOLLOWUP_METHOD_ICON[f.method] || '📝') + ' '}
              {constants.FOLLOWUP_METHOD_LABEL[f.method] || f.method} ·{' '}
              {formats.dateTimeToText(f.at)}
            </Text>
            {f.content ? <Text style={styles.fuContent}>{f.content}</Text> : null}
            {f.nextAt != null ? (
              <Text style={styles.fuNext}>
                下次跟进：{formats.dateTimeToText(f.nextAt)}
                {f.nextPlan ? ' · ' + f.nextPlan : ''}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={() =>
                Alert.alert('删除跟进记录', '确定删除这条记录？', [
                  { text: '取消', style: 'cancel' },
                  { text: '删除', style: 'destructive', onPress: () => store.deleteFollowup(f.id) },
                ])
              }
            >
              <Text style={styles.delLink}>删除</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* 资料编辑 */}
      <Text style={styles.sectionTitle}>资料</Text>
      <View style={styles.card}>
        <Text style={styles.label}>客户 / 公司名称</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Text style={styles.label}>联系人</Text>
        <TextInput style={styles.input} value={contact} onChangeText={setContact} />
        <Text style={styles.label}>联系电话</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <Text style={styles.label}>负责人</Text>
        <TextInput style={styles.input} value={owner} onChangeText={setOwner} />
        <Text style={styles.label}>备注</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={remark}
          onChangeText={setRemark}
          multiline
        />
        <TouchableOpacity style={styles.secondaryBtn} onPress={saveProfile}>
          <Text style={styles.secondaryBtnText}>保存资料</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.dangerBtn} onPress={confirmDelete}>
        <Text style={styles.dangerBtnText}>删除客户</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f5f6f8' },
  container: { padding: 12, paddingBottom: 60 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  name: { fontSize: 18, fontWeight: '700', color: '#222', flexShrink: 1 },
  stageBadge: {
    color: '#fff',
    fontSize: 12,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
    overflow: 'hidden',
  },
  nextCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10 },
  nextLabel: { fontSize: 12, color: '#888' },
  nextValue: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  btnRow: { flexDirection: 'row', marginBottom: 10 },
  primaryBtn: {
    backgroundColor: '#4f8ef7',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#eef3fe',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flex: 1,
  },
  secondaryBtnText: { color: '#4f8ef7', fontSize: 15, fontWeight: '600' },
  dangerBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e05b5b',
  },
  dangerBtnText: { color: '#e05b5b', fontSize: 15 },
  formCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginTop: 12, marginBottom: 8 },
  label: { fontSize: 12, color: '#666', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: '#999', marginTop: 6, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#f0f1f4',
  },
  chipActive: { backgroundColor: '#4f8ef7' },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  kv: { fontSize: 13, color: '#555', marginBottom: 4 },
  kvStrong: { fontWeight: '700', color: '#4caf7d' },
  historyLine: { fontSize: 11, color: '#888', marginTop: 2 },
  fuTitle: { fontSize: 13, fontWeight: '600', color: '#333' },
  fuContent: { fontSize: 13, color: '#555', marginTop: 4 },
  fuNext: { fontSize: 12, color: '#4f8ef7', marginTop: 4 },
  delLink: { fontSize: 12, color: '#e05b5b', marginTop: 8 },
});
