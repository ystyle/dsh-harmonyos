// dsh-harmonyos compat loader: 把 dsh 树(node_modules 内)对 node:zlib / node:module / fs-ext / sharp
// 的导入映射到本包 compat shim:
//   - node:zlib / node:module → 旧 node 缺 zstd/stripTypeScriptTypes 时补齐(新 node 原生优先)
//   - fs-ext → 鸿蒙无 fs_ext.node, stub 为立即成功(官方 browser worker 部署同款方案)
//   - sharp → 默认**不拦截**: 树内 @img/sharp-wasm32(纯 wasm)在 node>=22.16 下可直接处理图片。
//     设 DSH_OHOS_SHARP=shim 可退回“抛 SHARP_UNAVAILABLE → INVALID_IMAGE 降级”旧行为。
//
// 注册方式有两条(见 register.mjs), 共用下面这份实现:
//   - module.registerHooks(): node >= 22.15, **同步**钩子, 主线程内进程内执行
//   - module.register():       node 20.6~22.14, 异步钩子, 跑在 loader 线程(本机 node26 上已弃用 DEP0205)
// registerHooks 路径要求 resolve 是同步函数(返回 Promise 会 ERR_INVALID_RETURN_PROPERTY_VALUE),
// 故此处写成同步: 只做 URL 替换, 不 await 任何东西; 同步模式下 nextResolve 也同步返回。
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIMS = {
  'fs-ext': join(HERE, 'fs-ext-shim.mjs'),
};
// 原生能力优先: node:zlib 的 zstd(node>=22.16)与 node:module 的
// stripTypeScriptTypes(node>=22.18)已有原生实现时**不**走 shim, 只有旧 node 才补齐。
// 曾无条件 shim node:zlib: node26 + undici8(decompress.js 内 CJS require('node:zlib'))
// 会被重定向到含 top-level await 的 zlib-shim.mjs → ERR_REQUIRE_ASYNC_MODULE 启动即崩
// (0.1.5-rc.1 依赖树引入 undici 8 后实测)。原生可用即透传, 语义与 shim 的原生分支一致。
const compatRequire = createRequire(import.meta.url);
if (typeof compatRequire('node:zlib').createZstdCompress !== 'function') {
  SHIMS['node:zlib'] = join(HERE, 'zlib-shim.mjs');
}
if (typeof compatRequire('node:module').stripTypeScriptTypes !== 'function') {
  SHIMS['node:module'] = join(HERE, 'module-shim.mjs');
}
// koffi: 默认走树里真实构建(自愈 ensure-koffi 已编译+签名); DSH_OHOS_KOFFI=shim 退回 stub。
if (process.env.DSH_OHOS_KOFFI === 'shim') SHIMS['koffi'] = join(HERE, 'koffi-shim.mjs');
if (process.env.DSH_OHOS_SHARP === 'shim') SHIMS['sharp'] = join(HERE, 'sharp-shim.mjs');
const urls = {};
for (const [k, v] of Object.entries(SHIMS)) urls[k] = pathToFileURL(v).href;

/** 同步 resolve 钩子(两条注册路径共用)。 */
export function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? '';
  const shim = SHIMS[specifier];
  if (shim && parent.includes('/node_modules/') && !parent.startsWith(urls[specifier])) {
    return { url: urls[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
