#!/usr/bin/env node
// cutover: 把 package.json dependencies 里 8 条 fork 别名同步到 FORKS 清单的当前版本。
//
// 机制说明(为什么是 dependencies 别名而不是 overrides):
//   npm 的 overrides 只在「命令根项目」的 package.json 生效 —— 把 dsh-harmonyos 作为依赖安装
//   (npm i -g / npm i dsh-harmonyos)时, 包内自带的 overrides 被 npm 忽略, fork 装不上。
//   而 dependencies 里的别名( "官方名": "npm:@dsh-harmonyos/<pkg>@<ver>" )在任意安装场景都生效,
//   因此 fork 固化走 dependencies 别名(见 docs/plans/fork-overrides-consolidation.md)。
//
// 何时用: 上游升级 / fork 自身修复后(先 npm run sync-forks -- --publish 发新 fork 版本),
//   再跑本脚本把 package.json 别名指向新版本, 然后发本体。
//
// 用法:
//   npm run cutover                # dry-run(默认): 打印将更新的别名
//   npm run cutover -- --apply     # 写入 package.json 并提示跑 npm install 更新 lockfile
//
// 为什么 patch.mjs 不用改:
//   每个补丁函数都已按"自己的标记"幂等 —— fork 包(自带标记)装进来后,
//   patch.mjs 对应函数读到标记即跳过(changed:false), 天然退役;
//   未 fork 的残余(permission/settingsCompat/loopbackAuth 等)仍由 patch.mjs 兜底。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORKS, forkVersion } from './forks-list.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = join(ROOT, 'package.json');

const dryRun = !process.argv.includes('--apply');

function buildAliases() {
  const aliases = {};
  for (const f of FORKS) aliases[f.upstream] = `npm:${f.fork}@${forkVersion(f)}`;
  return aliases;
}

function main() {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  const aliases = buildAliases();

  // 迁移: 0.10.0 用 overrides, 0.10.1 起用 dependencies 别名 —— 残留 overrides 一律移除。
  const staleOverrides = Object.keys(aliases).filter((k) => pkg.overrides?.[k] !== undefined);

  let changed = false;
  const lines = [];
  for (const [k, v] of Object.entries(aliases)) {
    if (pkg.dependencies[k] !== v) {
      changed = true;
      lines.push(`  ${k}: ${pkg.dependencies[k] || '(无)'} → ${v}`);
      if (!dryRun) pkg.dependencies[k] = v;
    }
  }

  if (dryRun) {
    console.log('-- dry-run(默认): 将更新以下 dependencies 别名, 加 --apply 生效 --');
    console.log(lines.length ? lines.join('\n') : '  (已是最新, 无需变更)');
    if (staleOverrides.length) console.log(`\n注意: package.json 仍残留 ${staleOverrides.length} 条旧 overrides(0.10.0 机制), --apply 会一并移除。`);
    console.log('\n写入后 npm install --package-lock-only 更新 lockfile; 任一安装场景(npm i -g 等)都会解析到 fork。');
    return;
  }

  if (staleOverrides.length) {
    for (const k of staleOverrides) delete pkg.overrides[k];
    if (!Object.keys(pkg.overrides).length) delete pkg.overrides;
  }
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  if (!changed && !staleOverrides.length) {
    console.log('✓ dependencies 别名已是最新, 无变更');
    return;
  }
  console.log(`✓ 已更新 ${lines.length} 条别名${staleOverrides.length ? `, 移除 ${staleOverrides.length} 条旧 overrides` : ''}`);
  console.log('  下一步: npm install --package-lock-only && npm ci --ignore-scripts && npm test 验证后发本体。');
}

main();
