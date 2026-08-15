/**
 * EventForm.js — 日程新增 / 编辑表单（以 modal 形式打开）。
 *
 * 字段：标题 / 描述 / 是否全天 / 日期 / 开始·结束时间 / 优先级 / 分类 / 重复(类型+间隔+结束日期) / 提前提醒。
 * 校验复用 shared/utils.validateEvent。
 *
 * 重复日程说明（MVP）：
 *   - 编辑某一次实例 = 编辑整个系列（点开的是基础记录）；
 *   - 删除某一次实例 = 写入 exceptions[occurrenceKey] = true
 *     （被 shared/utils.expandOccurrences 跳过，实现「仅删除本次」）。
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { useSyncExternalStore } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';

import store from '../store';
import formats from '../formats';
import shared from '../shared';
import ChipGroup from './ChipGroup';
import CategoryPicker from './CategoryPicker';

const { utils, constants } = shared;
const { PRIORITY, PRIORITY_LABEL, REPEAT_TYPE, REPEAT_LABEL, REMIND_OPTIONS } = constants;

const REPEAT_OPTIONS = [
  { value: REPEAT_TYPE.NONE, label: REPEAT_LABEL.none },
  { value: REPEAT_TYPE.DAILY, label: REPEAT_LABEL.daily },
  { value: REPEAT_TYPE.WEEKLY, label: REPEAT_LABEL.weekly },
  { value: REPEAT_TYPE.MONTHLY, label: REPEAT_LABEL.monthly },
];
const PRIORITY_OPTIONS = [
  { value: PRIORITY.LOW, label: PRIORITY_LABEL.low },
  { value: PRIORITY.MEDIUM, label: PRIORITY_LABEL.medium },
  { value: PRIORITY.HIGH, label: PRIORITY_LABEL.high },
];
const REMIND_OPTIONS_CHIPS = REMIND_OPTIONS.map((m) => ({
  value: m,
  label: m === 0 ? '不提醒' : m + ' 分钟',
}));

export default function EventForm() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params || {};
  const id = params.id; // 有值 = 编辑已有日程
  const occurrenceKey = params.occurrenceKey; // 有值 = 重复日程的某一次实例

  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const editing = id ? store.getById('event', id) : null;

  useEffect(() => {
    if (id && !editing) {
      Alert.alert('提示', '未找到该日程（可能已被删除）', [{ text: '好', onPress: () => navigation.goBack() }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOccurrence = !!(
    occurrenceKey &&
    editing &&
    editing.repeat &&
    editing.repeat.type &&
    editing.repeat.type !== REPEAT_TYPE.NONE
  );

  // ---- 表单状态（初始值来自编辑记录或默认值） ----
  const [title, setTitle] = useState(editing ? editing.title || '' : '');
  const [description, setDescription] = useState(editing ? editing.description || '' : '');
  const [allDay, setAllDay] = useState(editing ? !!editing.allDay : false);
  const [dateText, setDateText] = useState(editing ? utils.toDateStr(editing.startTime) : formats.nowDateText());
  const [startText, setStartText] = useState(editing ? utils.toTimeStr(editing.startTime) : formats.nowTimeText());
  const [endText, setEndText] = useState(
    editing ? utils.toTimeStr(editing.endTime) : utils.toTimeStr(Date.now() + 3600 * 1000)
  );
  const [priority, setPriority] = useState(editing ? editing.priority || PRIORITY.MEDIUM : PRIORITY.MEDIUM);
  const [repeatType, setRepeatType] = useState(
    editing && editing.repeat ? editing.repeat.type || REPEAT_TYPE.NONE : REPEAT_TYPE.NONE
  );
  const [repeatInterval, setRepeatInterval] = useState(
    editing && editing.repeat && editing.repeat.interval ? String(editing.repeat.interval) : '1'
  );
  const [repeatEndText, setRepeatEndText] = useState(
    editing && editing.repeat && editing.repeat.endDate ? utils.toDateStr(editing.repeat.endDate) : ''
  );
  const [remindBefore, setRemindBefore] = useState(
    editing ? (editing.remindBefore != null ? editing.remindBefore : 0) : 0
  );
  const [category, setCategory] = useState(() => {
    if (editing && editing.categoryId) {
      return { id: editing.categoryId, name: editing.categoryName || '', color: editing.categoryColor || '' };
    }
    const cats = store.getCategories();
    if (cats.length) {
      const first = cats[0];
      return { id: first.id, name: first.name, color: first.color };
    }
    const fb = constants.DEFAULT_CATEGORIES[0];
    return fb ? { id: '__default_0', name: fb.name, color: fb.color } : { id: '', name: '', color: '' };
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 组装输入并校验；返回 null 表示校验失败（错误已 setError）
  function buildInput() {
    const dateTs = formats.parseDateText(dateText);
    const startMin = formats.parseTimeText(startText);
    const endMin = formats.parseTimeText(endText);

    let startTime;
    let endTime;
    if (allDay) {
      if (dateTs == null) {
        setError('日期格式应为 YYYY-MM-DD');
        return null;
      }
      startTime = dateTs;
      endTime = dateTs + 24 * 3600 * 1000 - 1; // 全天：当天 00:00 ~ 23:59:59
    } else {
      if (dateTs == null || startMin == null || endMin == null) {
        setError('请填写正确的日期（YYYY-MM-DD）与时间（HH:mm）');
        return null;
      }
      startTime = dateTs + startMin * 60000;
      endTime = dateTs + endMin * 60000;
    }

    const interval = parseInt(repeatInterval, 10);
    let endDate = null;
    if (repeatEndText.trim()) {
      endDate = formats.parseDateText(repeatEndText);
      if (endDate == null) {
        setError('重复结束日期格式应为 YYYY-MM-DD');
        return null;
      }
    }

    const input = {
      title: title.trim(),
      description: description.trim(),
      allDay,
      startTime,
      endTime,
      priority,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      repeat: { type: repeatType, interval: isNaN(interval) || interval < 1 ? 1 : interval, endDate },
      remindBefore,
    };

    const v = utils.validateEvent(input);
    if (!v.ok) {
      setError(v.errors.join('；'));
      return null;
    }
    return input;
  }

  function onSave() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    if (editing) {
      store.updateEvent(id, input);
    } else {
      store.createEvent(input);
    }
    navigation.goBack();
  }

  function onDelete() {
    if (!editing) return;
    const buttons = [];
    if (isOccurrence) {
      buttons.push(
        {
          text: '仅删除本次',
          style: 'destructive',
          onPress: () => {
            store.deleteEventOccurrence(id, occurrenceKey);
            navigation.goBack();
          },
        },
        {
          text: '删除整个系列',
          style: 'destructive',
          onPress: () => {
            store.deleteEvent(id);
            navigation.goBack();
          },
        }
      );
    } else {
      buttons.push({
        text: '删除',
        style: 'destructive',
        onPress: () => {
          store.deleteEvent(id);
          navigation.goBack();
        },
      });
    }
    buttons.push({ text: '取消', style: 'cancel' });
    Alert.alert(
      '删除日程',
      isOccurrence ? '这是重复日程的某一次实例，请选择删除方式：' : '确定删除该日程？',
      buttons
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {isOccurrence ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              这是重复日程的某一次实例：修改将作用于整个系列；删除可选「仅删除本次」。
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>标题 *</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="日程标题" />

        <Text style={styles.label}>描述</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="备注（可选）"
          multiline
        />

        <View style={styles.switchRow}>
          <Text style={styles.label}>全天</Text>
          <Switch value={allDay} onValueChange={setAllDay} />
        </View>

        <Text style={styles.label}>日期（YYYY-MM-DD）</Text>
        <TextInput
          style={styles.input}
          value={dateText}
          onChangeText={setDateText}
          placeholder="2024-01-01"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {!allDay ? (
          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <Text style={styles.label}>开始（HH:mm）</Text>
              <TextInput
                style={styles.input}
                value={startText}
                onChangeText={setStartText}
                placeholder="09:00"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.timeCol}>
              <Text style={styles.label}>结束（HH:mm）</Text>
              <TextInput
                style={styles.input}
                value={endText}
                onChangeText={setEndText}
                placeholder="10:00"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>
        ) : null}

        <Text style={styles.label}>优先级</Text>
        <ChipGroup options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} />

        <Text style={styles.label}>分类</Text>
        <CategoryPicker
          categories={store.getCategories()}
          selectedId={category.id}
          onSelect={(c) => setCategory({ id: c.id, name: c.name, color: c.color })}
        />

        <Text style={styles.label}>重复</Text>
        <ChipGroup options={REPEAT_OPTIONS} value={repeatType} onChange={setRepeatType} />
        {repeatType !== REPEAT_TYPE.NONE ? (
          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <Text style={styles.label}>间隔（天/周/月）</Text>
              <TextInput
                style={styles.input}
                value={repeatInterval}
                onChangeText={setRepeatInterval}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.timeCol}>
              <Text style={styles.label}>结束日期（可空）</Text>
              <TextInput
                style={styles.input}
                value={repeatEndText}
                onChangeText={setRepeatEndText}
                placeholder="2024-12-31"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>
        ) : null}

        <Text style={styles.label}>提前提醒</Text>
        <ChipGroup options={REMIND_OPTIONS_CHIPS} value={remindBefore} onChange={setRemindBefore} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.btnRow}>
          {editing ? (
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={onDelete}>
              <Text style={styles.btnText}>删除</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
            onPress={onSave}
            disabled={saving}
          >
            <Text style={styles.btnText}>保存</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 16, paddingBottom: 40 },
  notice: {
    backgroundColor: '#fff7e6',
    borderColor: '#f2a541',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  noticeText: { color: '#8a5a00', fontSize: 12, lineHeight: 18 },
  label: { fontSize: 13, color: '#555', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeRow: { flexDirection: 'row' },
  timeCol: { flex: 1, marginRight: 8 },
  error: { color: '#e05b5b', marginTop: 12, fontSize: 13 },
  btnRow: { flexDirection: 'row', marginTop: 24 },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    marginRight: 8,
  },
  btnPrimary: { backgroundColor: '#4f8ef7' },
  btnDanger: { backgroundColor: '#e05b5b' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
