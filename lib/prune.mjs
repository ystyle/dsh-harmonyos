// dsh-harmonyos tree prune: 从本包 node_modules 剪掉「原生编译/设备上无意义」的包。
// 安全性: overlays/harmonyos.patch.yml 已在 profile 层禁用对应行, cordis 运行时绝不 import 它们。
// 0.1.3-alpha.2 起 npm 11 可能把包嵌套进上层包(版本冲突时), 故按 basename 递归找所有出现位置,
// 不再假设平铺布局。
import { rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDshDir } from './locate.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// 平铺(npm -g)与嵌套布局都支持, 见 lib/locate.mjs。
const NM = join(locateDshDir(ROOT), 'node_modules');

// 原生(或未编译残留): 仅剪纯宿主包。koffi/node-pty 保留在树 — 自愈 ensure-koffi/ensure-pty
// 会就地编译并补 .codesign(沙箱 dlopen 需要), 供 subprocess 行使用。
const BASENAMES = new Set([
  'dsh-pwsh-sandbox',
]);

let removed = 0;
(function walk(dir, depth) {
  if (depth > 7) return;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const full = join(dir, e.name);
    if (BASENAMES.has(e.name)) {
      rmSync(full, { recursive: true, force: true });
      removed += 1;
      console.log(`prune: 移除 ${e.name} (${full})`);
      continue;
    }
    walk(full, depth + 1);
  }
})(NM, 0);
console.log(`prune: 完成, 移除 ${removed} 个包`);
