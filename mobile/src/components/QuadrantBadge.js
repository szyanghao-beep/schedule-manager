/**
 * QuadrantBadge.js — 四象限彩色徽标。
 * 复用 shared/constants 的 QUADRANT_LABEL（中文名）与 QUADRANT_COLOR（颜色）。
 * 象限由 shared/utils.calcQuadrant 计算后传入。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import shared from '../shared';

const { constants } = shared;

export default function QuadrantBadge({ quadrant, style }) {
  const q = quadrant || constants.QUADRANT.Q4;
  const color = constants.QUADRANT_COLOR[q] || '#8a8f98';
  const label = constants.QUADRANT_LABEL[q] || q;
  return (
    <View style={[styles.badge, { backgroundColor: color }, style]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  text: { color: '#fff', fontSize: 11 },
});
