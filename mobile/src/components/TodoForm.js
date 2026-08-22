/**
 * TodoForm.js — 待办新增 / 编辑表单（以 modal 形式打开）。
 *
 * 字段：标题 / 描述 / 截止日期·时间（可空）/ 优先级 / 重要性（四象限手动维度）/
 *       分类 / 重复(类型+间隔+结束日期) / 提前提醒。
 * 校验复用 shared/utils.validateTodo。
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
const { PRIORITY, PRIORITY_LABEL, IMPORTANCE, IMPORTANCE_LABEL, REPEAT_TYPE, REPEAT_LABEL, REMIND_OPTIONS, ESTIMATED_MINUTES_OPTIONS } = constants;

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
const IMPORTANCE_OPTIONS = [
  { value: IMPORTANCE.IMPORTANT, label: IMPORTANCE_LABEL.important },
  { value: IMPORTANCE.NOT_IMPORTANT, label: IMPORTANCE_LABEL.not_important },
];
const REMIND_OPTIONS_CHIPS = REMIND_OPTIONS.map((m) => ({
  value: m,
  label: m === 0 ? '不提醒' : m + ' 分钟',
}));
const ESTIMATED_OPTIONS = [
  { value: null, label: '不设定' },
  ...ESTIMATED_MINUTES_OPTIONS.map((m) => ({ value: m, label: m + ' 分钟' })),
];

export default function TodoForm() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params || {};
  const id = params.id; // 有值 = 编辑已有待办

  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const editing = id ? store.getById('todo', id) : null;

  useEffect(() => {
    if (id && !editing) {
      Alert.alert('提示', '未找到该待办（可能已被删除）', [{ text: '好', onPress: () => navigation.goBack() }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [title, setTitle] = useState(editing ? editing.title || '' : '');
  const [description, setDescription] = useState(editing ? editing.description || '' : '');
  const [deadlineDateText, setDeadlineDateText] = useState(
    editing && editing.deadline ? utils.toDateStr(editing.deadline) : formats.nowDateText()
  );
  const [deadlineTimeText, setDeadlineTimeText] = useState(
    editing && editing.deadline ? utils.toTimeStr(editing.deadline) : utils.toTimeStr(Date.now() + 3600 * 1000)
  );
  const [priority, setPriority] = useState(editing ? editing.priority || PRIORITY.MEDIUM : PRIORITY.MEDIUM);
  const [importance, setImportance] = useState(
    editing ? editing.importance || IMPORTANCE.IMPORTANT : IMPORTANCE.IMPORTANT
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    editing ? editing.estimatedMinutes || null : null
  );
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
    let deadline = null;
    if (deadlineDateText.trim()) {
      const dateTs = formats.parseDateText(deadlineDateText);
      if (dateTs == null) {
        setError('截止日期格式应为 YYYY-MM-DD（留空表示无截止时间）');
        return null;
      }
      let min = 0;
      if (deadlineTimeText.trim()) {
        min = formats.parseTimeText(deadlineTimeText);
        if (min == null) {
          setError('截止时间格式应为 HH:mm');
          return null;
        }
      }
      deadline = dateTs + min * 60000;
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
      deadline,
      priority,
      importance,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      repeat: { type: repeatType, interval: isNaN(interval) || interval < 1 ? 1 : interval, endDate },
      remindBefore,
      estimatedMinutes,
    };

    const v = utils.validateTodo(input);
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
      store.updateTodo(id, input);
    } else {
      store.createTodo(input);
    }
    navigation.goBack();
  }

  function onDelete() {
    if (!editing) return;
    Alert.alert('删除待办', '确定删除该待办？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          store.deleteTodo(id);
          navigation.goBack();
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>标题 *</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="待办标题" />

        <Text style={styles.label}>描述</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="备注（可选）"
          multiline
        />

        <Text style={styles.label}>截止日期（YYYY-MM-DD，留空=无截止）</Text>
        <TextInput
          style={styles.input}
          value={deadlineDateText}
          onChangeText={setDeadlineDateText}
          placeholder="2024-01-01"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>截止时间（HH:mm，可空）</Text>
        <TextInput
          style={styles.input}
          value={deadlineTimeText}
          onChangeText={setDeadlineTimeText}
          placeholder="18:00"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>优先级</Text>
        <ChipGroup options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} />

        <Text style={styles.label}>重要性（四象限）</Text>
        <ChipGroup options={IMPORTANCE_OPTIONS} value={importance} onChange={setImportance} />

        <Text style={styles.label}>预估耗时（时间块）</Text>
        <ChipGroup options={ESTIMATED_OPTIONS} value={estimatedMinutes} onChange={setEstimatedMinutes} />

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
