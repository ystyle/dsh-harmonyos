// dsh-harmonyos compat loader: 把 dsh 树(node_modules 内)对 node:zlib / node:module / fs-ext / sharp
// 的导入映射到本包 compat shim:
//   - node:zlib / node:module → 旧 node 缺 zstd/stripTypeScriptTypes 时补齐(新 node 原生优先)
//   - fs-ext → 鸿蒙无 fs_ext.node, stub 为立即成功(官方 browser worker 部署同款方案)
//   - sharp → 鸿蒙无预编译二进制, 抛 SHARP_UNAVAILABLE, 调用方走 INVALID_IMAGE 降级路径
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIMS = {
  'node:zlib': join(HERE, 'zlib-shim.mjs'),
  'node:module': join(HERE, 'module-shim.mjs'),
  'fs-ext': join(HERE, 'fs-ext-shim.mjs'),
  'sharp': join(HERE, 'sharp-shim.mjs'),
};
const urls = {};
for (const [k, v] of Object.entries(SHIMS)) urls[k] = pathToFileURL(v).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? '';
  const shim = SHIMS[specifier];
  if (shim && parent.includes('/node_modules/') && !parent.startsWith(urls[specifier])) {
    return { url: urls[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
