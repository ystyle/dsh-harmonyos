// dsh-harmonyos tree prune: 从本包 node_modules 剪掉「原生编译/设备上无意义」的包。
// 安全性: overlays/harmonyos.patch.yml 已在 profile 层禁用对应行, cordis 运行时绝不 import 它们。
// 0.1.3-alpha.2 起 npm 11 可能把包嵌套进上层包(版本冲突时), 故按 basename 递归找所有出现位置,
// 不再假设平铺布局。
import { rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NM = join(ROOT, 'node_modules');

// 原生(或未编译残留): koffi 仅 Windows 懒加载, node-pty 行已禁用 — 删掉零影响。
// 只服务被禁用行的宿主包(纯 JS 但设备上无意义, 连坐删除)。
const BASENAMES = new Set([
  'koffi',
  'node-pty',
  'dsh-sandbox-local',
  'dsh-subprocess-local',
  'dsh-bash-sandbox',
  'dsh-pwsh-sandbox',
  'dsh-host-directory-picker-auto',
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
