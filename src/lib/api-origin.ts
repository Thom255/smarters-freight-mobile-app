/**
 * Resolves which host the Laravel backend (port 8001) lives on for the
 * current runtime — used by src/app/_layout.tsx at startup via
 * configureApiOrigin(). React Native imports live HERE, never in src/lib/api.ts,
 * so the API client stays plain `fetch` that Node test scripts can run.
 *
 * EXPO_PUBLIC_API_URL (root .env) always wins: when it is set this returns
 * null and the app behaves exactly as before. The derivation only replaces
 * the bare `http://localhost:8001` fallback, which is unreachable from a
 * device or emulator:
 *
 *   Android emulator  → http://10.0.2.2:8001   (the host machine's loopback)
 *   Physical device   → http://<LAN IP>:8001   (the Metro host's address,
 *                        i.e. the computer's reachable LAN IP)
 *   iOS simulator /   → http://<Metro host>:8001 (loopback-capable host)
 *   same-host web
 *
 * Port 8001 is the backend's required port — 8000 runs the separate SRS API.
 */

import Constants from 'expo-constants';
import { isDevice } from 'expo-device';
import { Platform } from 'react-native';

const API_PORT = '8001';

/** '192.168.1.107:8081' / 'http://192.168.1.107:8081' → '192.168.1.107' (IPv6 kept bracketed). */
function hostFromHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;

  const withoutScheme = hostUri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];

  if (withoutScheme.startsWith('[')) {
    const end = withoutScheme.indexOf(']');
    return end > 0 ? withoutScheme.slice(0, end + 1) : null;
  }

  const host = withoutScheme.split(':')[0];
  return host || null;
}

/**
 * Returns the origin to use, or null when the explicit env config (or the
 * plain localhost fallback) should be used instead.
 */
export function deviceApiOrigin(): string | null {
  // An explicit EXPO_PUBLIC_API_URL is the source of truth — never override it.
  if ((process.env.EXPO_PUBLIC_API_URL ?? '').trim() !== '') {
    return null;
  }

  // The emulator reaches the host machine through its reserved alias; using
  // it avoids depending on how the emulator NATs the host's LAN address.
  if (Platform.OS === 'android' && !isDevice) {
    return `http://10.0.2.2:${API_PORT}`;
  }

  // Metro reports which host the bundle was loaded from — that is the
  // development computer's LAN IP, reachable from any physical phone on the
  // same network (and from the simulator/emulator as well).
  const host = hostFromHostUri(Constants.expoConfig?.hostUri);
  if (host) {
    return `http://${host}:${API_PORT}`;
  }

  // No Metro host (standalone web build on this machine): loopback is right.
  if (Platform.OS === 'web') {
    return `http://localhost:${API_PORT}`;
  }

  return null;
}
