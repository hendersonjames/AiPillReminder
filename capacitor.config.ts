import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.remediapp.app',
  appName: 'Remedi',
  webDir: 'dist',
  // Server config: comment out for production builds, useful for live-reload dev
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:3000',
  //   cleartext: true,
  // },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#0ea5e9', // sky-500 — matches app theme
      sound: 'default',
    },
  },
  ios: {
    // iOS-specific config
    contentInset: 'automatic',
  },
  android: {
    // Android-specific config
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
