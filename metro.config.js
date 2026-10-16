// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The Laravel backend (backend/) is hosted remotely and must NEVER be part of
// the Expo bundle. Metro only follows imports from src/, but blockList makes
// that guarantee explicit: any file under backend/ is unresolvable and
// unwatched by Metro.
config.resolver.blockList = [
  /(^|[/\\])backend[/\\]/,
];

module.exports = config;
