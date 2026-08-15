/**
 * App.js — 应用入口与导航。
 *
 * 职责：
 *   - 启动时从 AsyncStorage 恢复本地数据（store.load），加载期间显示 Splash；
 *   - 登录态分流：未登录 -> Login 页；已登录 -> 主界面（底部 Tab：日程/待办/我的）
 *     以及以 modal 形式压栈的表单页（EventForm / TodoForm）；
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
import LoginScreen from './src/screens/LoginScreen';
import EventsScreen from './src/screens/EventsScreen';
import TodosScreen from './src/screens/TodosScreen';
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
  // 订阅 store：token 变化时自动在 Login 与主界面之间切换
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const token = store.getToken();
  if (!store.isLoaded()) return <Splash />;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerTitleAlign: 'center', headerBackTitle: '返回' }}>
        {token ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
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
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
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
