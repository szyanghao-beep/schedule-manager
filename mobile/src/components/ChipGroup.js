/**
 * ChipGroup.js — 单选标签组（优先级 / 重要性 / 重复类型 / 提醒提前量等）。
 * options: [{value, label}]；value 为当前选中值；onChange(value) 回调。
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ChipGroup({ options, value, onChange, style }) {
  return (
    <View style={[styles.row, style]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={String(o.value)}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[styles.text, active && styles.textActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: '#4f8ef7', backgroundColor: '#4f8ef7' },
  text: { fontSize: 13, color: '#333' },
  textActive: { color: '#fff', fontWeight: '600' },
});
