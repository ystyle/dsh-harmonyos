#!/usr/bin/env node
// cutover-overrides: 把 package.json overrides 从 file:(本地验证) 切到 npm: 别名(真机制)。
//
// 何时用: @dsh-harmonyos/* fork 包发布到 npm 之后(见 docs/plans/fork-overrides-consolidation.md)。
// 前置: 本机已跑过 `npm run sync-forks -- --publish` 发布全部 fork 包。
//
// 用法:
//   npm run cutover -- --dry-run   # 只打印将写入的 overrides(默认)
//   npm run cutover                # 写入 package.json overrides(生产切换)
//
// 为什么 patch.mjs 不用改:
//   每个补丁函数都已按"自己的标记"幂等 —— fork 包(自带标记)装进来后,
//   patch.mjs 对应函数读到标记即跳过(changed:false), 天然退役;
//   未 fork 的残余(loopbackAuth 等)与未来未对齐的场景仍由 patch.mjs 兜底。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORKS, forkVersion } from './forks-list.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = join(ROOT, 'package.json');

const dryRun = !process.argv.includes('--apply');

function buildOverrides() {
  const overrides = {};
  for (const f of FORKS) overrides[f.upstream] = `npm:${f.fork}@${forkVersion(f)}`;
  return overrides;
}

function main() {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  const overrides = buildOverrides();

  if (pkg.overrides && JSON.stringify(pkg.overrides) === JSON.stringify(overrides)) {
    console.log('✓ package.json overrides 已是指向 fork 的 npm: 别名, 无需变更');
    return;
  }

  const next = { ...pkg, overrides: { ...(pkg.overrides || {}), ...overrides } };
  const block = JSON.stringify({ overrides: next.overrides }, null, 2);

  if (dryRun) {
    console.log('-- dry-run(默认): 将写入以下 overrides, 加 --apply 生效 --');
    console.log(block);
    console.log('\n写入后 npm ci 会解析到 @dsh-harmonyos/*(需已发布); patch.mjs 对应条目自动变 no-op。');
    return;
  }

  writeFileSync(PKG, JSON.stringify(next, null, 2) + '\n');
  console.log(`✓ 已写入 ${FORKS.length} 条 overrides 别名到 package.json`);
  console.log('  提示: patch.mjs 无需改动(幂等自退役); 跑 npm ci + npm test 验证后即可发版。');
}

main();
