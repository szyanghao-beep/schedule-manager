/**
 * App.js — 应用入口与导航。
 *
 * 职责：
 *   - 启动时从 AsyncStorage 恢复本地数据（store.load），加载期间显示 Splash；
 *   - 主界面底部 Tab：收集 / 日程 / 待办 / 客户 / 我的；
 *     ★「收集」页免登录可用（离线随手记 → 手动直传电脑收件箱），
 *       日程/待办/客户/我的需要登录同步账号（未登录时在「我的」页登录）；
 *   - 启动后：注册自动推送（startAutoPush），已有 token 时立即同步一次。
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSyncExternalStore } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import store from './src/store';
import syncClient from './src/syncClient';
import notifications from './src/notifications';
import LoginScreen from './src/screens/LoginScreen';
import CollectScreen from './src/screens/CollectScreen';
import EventsScreen from './src/screens/EventsScreen';
import TodosScreen from './src/screens/TodosScreen';
import CustomersScreen from './src/screens/CustomersScreen';
import CustomerDetailScreen from './src/screens/CustomerDetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EventForm from './src/components/EventForm';
import TodoForm from './src/components/TodoForm';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// 底部 Tab 图标：用 emoji 文本，避免额外引入图标库
function makeTabIcon(emoji) {
  return ({ color, size }) => <Text style={{ fontSize: size - 2, color }}>{emoji}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        tabBarActiveTintColor: '#4f8ef7',
      }}
    >
      <Tab.Screen
        name="Collect"
        component={CollectScreen}
        options={{ title: '收集', headerShown: false, tabBarIcon: makeTabIcon('📥') }}
      />
      <Tab.Screen
        name="Events"
        component={EventsScreen}
        options={{ title: '日程', headerShown: false, tabBarIcon: makeTabIcon('📅') }}
      />
      <Tab.Screen
        name="Todos"
        component={TodosScreen}
        options={{ title: '待办', tabBarIcon: makeTabIcon('✅') }}
      />
      <Tab.Screen
        name="Customers"
        component={CustomersScreen}
        options={{ title: '客户', headerShown: false, tabBarIcon: makeTabIcon('🤝') }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: '我的', tabBarIcon: makeTabIcon('👤') }}
      />
    </Tab.Navigator>
  );
}

function Splash() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color="#4f8ef7" />
      <Text style={styles.splashText}>加载本地数据…</Text>
    </View>
  );
}

function Root() {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!store.isLoaded()) return <Splash />;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerTitleAlign: 'center', headerBackTitle: '返回' }}>
        {/* 主界面始终可用：「收集」免登录；登录作为模态页，从「我的」进入 */}
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ presentation: 'modal', title: '登录同步账号' }}
        />
        <Stack.Screen
          name="EventForm"
          component={EventForm}
          options={{ presentation: 'modal', title: '日程' }}
        />
        <Stack.Screen
          name="TodoForm"
          component={TodoForm}
          options={{ presentation: 'modal', title: '待办' }}
        />
        <Stack.Screen
          name="CustomerDetail"
          component={CustomerDetailScreen}
          options={{ presentation: 'modal', title: '客户' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    let mounted = true;
    store.load().then(() => {
      if (!mounted) return;
      syncClient.startAutoPush(store);
      if (store.getToken()) syncClient.syncNow(); // 启动后自动同步一次
      notifications.init(); // 本地通知：请求权限 + 首次排程 + 数据变更防抖重排
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  splashText: { marginTop: 12, color: '#666' },
});
