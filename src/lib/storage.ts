/**
 * Tiny key/value storage abstraction.
 *
 * - iOS/Android: expo-secure-store (encrypted)
 * - Web: localStorage (SecureStore has no web implementation)
 * - Server (static prerendering): in-memory, never hit in practice because
 *   reads only happen from effects on the client.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage full or blocked — session simply won't persist.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore blocked storage.
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
