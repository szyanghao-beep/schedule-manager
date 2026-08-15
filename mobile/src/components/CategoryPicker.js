/**
 * CategoryPicker.js — 分类选择（色块标签）。
 * 服务端尚未同步分类时，回退到 shared/constants 的默认分类（DEFAULT_CATEGORIES）。
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import shared from '../shared';

const { constants } = shared;

export default function CategoryPicker({ categories, selectedId, onSelect }) {
  const list =
    categories && categories.length
      ? categories
      : constants.DEFAULT_CATEGORIES.map((c, i) => ({
          id: '__default_' + i,
          name: c.name,
          color: c.color,
        }));
  return (
    <View style={styles.row}>
      {list.map((c) => {
        const active = c.id === selectedId;
        return (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, active && { borderColor: c.color, backgroundColor: c.color + '22' }]}
            onPress={() => onSelect(c)}
          >
            <View style={[styles.dot, { backgroundColor: c.color }]} />
            <Text style={styles.text}>{c.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  text: { fontSize: 13, color: '#333' },
});
