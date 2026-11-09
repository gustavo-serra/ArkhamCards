import Config from 'react-native-config';
import Constants from 'expo-constants';

/**
 * Get environment variable with fallback to expo-constants
 * react-native-config doesn't work properly with Expo builds on Android
 */
export function getEnvVar(key: string): string {
  const fromConfig = Config[key];
  const rawValue = fromConfig || Constants.expoConfig?.extra?.[key] || process.env[key] || '';
  if (key === 'OAUTH_SITE' && (!rawValue || rawValue.includes('127.0.0.1'))) {
    return 'https://arkhamdb.com/';
  }
  return rawValue;
}

export const USE_PATREON_AUDIO = true;
