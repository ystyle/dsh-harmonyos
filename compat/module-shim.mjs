// node:module 兼容层: 补 node 22.7 缺失的导出。
// node >= 22.18 已有原生 stripTypeScriptTypes / findPackageJSON 等, 直接透传原生实现;
// 旧 node(node 22.7 鸿蒙自带)才用保守空实现(官方插件均为编译后 JS, 无实际 TS 剥离需求)。
export * from 'node:module';
import { Transform } from 'node:stream';
import * as nodeModule from 'node:module';

const HAS_NATIVE_STRIP = typeof nodeModule.stripTypeScriptTypes === 'function';

export function stripTypeScriptTypes(code) {
  if (HAS_NATIVE_STRIP) return nodeModule.stripTypeScriptTypes(code);
  return code;
}
export function enableCompileCache() {
  if (typeof nodeModule.enableCompileCache === 'function') return nodeModule.enableCompileCache();
  return { cacheDirectory: undefined, wasEnabled: false };
}
export function findPackageJSON() {
  if (typeof nodeModule.findPackageJSON === 'function') return nodeModule.findPackageJSON();
  return undefined;
}
export function registerHooks() {
  if (typeof nodeModule.registerHooks === 'function') return nodeModule.registerHooks();
  /* no-op */
}
