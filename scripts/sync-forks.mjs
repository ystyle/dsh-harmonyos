#!/usr/bin/env node
// sync-forks: 重建 / 校验 / 发布 @dsh-harmonyos/* fork 包。
//
// 模型（docs/plans/fork-overrides-consolidation.md §4.3/§4.4）:
//   diff 即真值 —— fork 包 = "上游发布物 tarball + fork-patches/<pkg>.patch" 临时重建后发布。
//   不建 fork 源码仓库; 维护对象就是 fork-patches/ 下的 diff 文件。
//
// 用法:
//   npm run sync-forks                 # sync(默认): 重建全部 fork 到 .forks-out/ 并校验标记
//   npm run sync-forks -- --publish    # 校验通过后 npm publish @dsh-harmonyos/*@<ver>-harmony.<n>
//   npm run sync-forks -- --check      # 只校验 .forks-out/ 现有产物(不重新拉取, CI 用)
//   npm run sync-forks -- --materialize  # 同 sync, 明确落盘完整源码(调试用)
//
// 环境变量:
//   NODE_AUTH_TOKEN  发布时所需 npm access token
//   FORK_REGISTRY    默认 https://registry.npmjs.org
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PATCH_DIR = join(ROOT, 'fork-patches');
const OUT_DIR = join(ROOT, '.forks-out');
const REGISTRY = process.env.FORK_REGISTRY || 'https://registry.npmjs.org';

// ── fork 清单 ──────────────────────────────────────────────────────────────
// version 必须与 package.json 里 @deepseek-ai/dsh 的 pin 同步(两处一起升)。
// harmony 序号: fork 自身修复时 +1, 重新跟随上游版本时回到 1。
// markers: diff 应用后产物必须包含的标记(等价于旧 lib/anchors.mjs 的语义)。
const FORKS = [
  {
    fork: '@dsh-harmonyos/dsh-session-persistence-jsonl',
    upstream: '@deepseek-ai/dsh-session-persistence-jsonl',
    version: '0.1.5-rc.1',
    harmony: 1,
    patch: 'dsh-session-persistence-jsonl.patch',
    markers: [
      'HarmonyOS patch: publishCurrentExclusive',
      'HarmonyOS patch: 本机不支持硬链接(EPERM)，link→rename',
    ],
  },
  // M1 追加(见方案附录 A): attachment-local / fs-local / node-addon-system /
  // client-resources / tool-fs-search / credentials-local / sandbox-policy
];

const cmd = process.argv[2] || 'sync';
const publish = process.argv.includes('--publish');
if (publish && !process.env.NODE_AUTH_TOKEN) {
  console.error('✗ --publish 需要 NODE_AUTH_TOKEN(发布 @dsh-harmonyos/* 用)');
  process.exit(1);
}

function sh(args, cwd) {
  return execFileSync('bash', ['-c', args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function forkVersion(f) {
  return `${f.version}-harmony.${f.harmony}`;
}

/** 解包上游 tarball 到 dir, 返回 tgz 路径。 */
function packAndExtract(f, dir) {
  mkdirSync(dir, { recursive: true });
  const packOut = sh(`npm pack ${f.upstream}@${f.version} --ignore-scripts --silent --registry=${REGISTRY}`, dir).trim();
  const tgz = join(dir, packOut.trim());
  if (!existsSync(tgz)) throw new Error(`${f.fork}: npm pack 失败, 输出=${packOut}`);
  sh(`tar -xzf "${tgz}" -C "${dir}" --strip-components=1`, dir);
  rmSync(tgz, { force: true });
  return dir;
}

/** 应用 diff(优先 git apply, 回退 patch -p1)。失败即抛错并列出失配上下文。 */
function applyPatch(f, dir) {
  const patchFile = join(PATCH_DIR, f.patch);
  if (!existsSync(patchFile)) throw new Error(`${f.fork}: 缺少 ${f.patch}`);
  try {
    sh(`git apply --whitespace=nowarn "${patchFile}"`, dir);
  } catch (e) {
    try {
      sh(`patch -p1 -N < "${patchFile}"`, dir);
    } catch (e2) {
      throw new Error(`${f.fork}: diff 应用失败 —— 上游该版本代码可能已变动, 需人工修 ${f.patch}\n` +
        `git apply 输出: ${String(e.stderr || e.message).slice(0, 400)}\n` +
        `patch -p1 输出: ${String(e2.stderr || e2.message).slice(0, 400)}`);
    }
  }
}

/** 校验标记: 产物内所有 .js 必须包含每个标记(等价旧 anchors 语义)。 */
function checkMarkers(f, dir) {
  const missing = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const txt = readFileSync(p, 'utf8');
        for (const m of f.markers) if (txt.includes(m) && !missing.includes(m)) missing.push(m);
      }
    }
  };
  walk(dir);
  const absent = f.markers.filter((m) => !missing.includes(m));
  if (absent.length) {
    throw new Error(`${f.fork}: 标记缺失 ${absent.join(', ')} —— diff 应用可能不完整`);
  }
  console.log(`  ✓ 标记齐全(${f.markers.length})`);
}

/** 改写 package.json: 名字换成 fork 名, 版本 = 上游版本-harmony.n。 */
function rewriteManifest(f, dir) {
  const pj = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pj, 'utf8'));
  pkg.name = f.fork;
  pkg.version = forkVersion(f);
  writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n');
}

function materializeOne(f) {
  const label = `${f.fork}@${forkVersion(f)}`;
  const dir = join(OUT_DIR, f.fork.replace('@dsh-harmonyos/', ''));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`▶ ${label}`);
  console.log(`  拉取上游 ${f.upstream}@${f.version} …`);
  packAndExtract(f, dir);
  console.log(`  应用 ${f.patch} …`);
  applyPatch(f, dir);
  checkMarkers(f, dir);
  rewriteManifest(f, dir);
  console.log(`  ✔ 产物就绪: ${dir}`);
  return dir;
}

function publishOne(f, dir) {
  const ver = forkVersion(f);
  console.log(`  发布 ${f.fork}@${ver} …`);
  const out = sh(`npm publish "${dir}" --access public --registry=${REGISTRY}`, ROOT).trim();
  console.log(`  ✔ ${out.split('\n').pop()}`);
}

function checkExisting(f) {
  const dir = join(OUT_DIR, f.fork.replace('@dsh-harmonyos/', ''));
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`${f.fork}: .forks-out 无产物, 先跑 sync`);
  }
  console.log(`▶ ${f.fork}@${forkVersion(f)} (check)`);
  checkMarkers(f, dir);
}

function main() {
  if (cmd === 'check') {
    for (const f of FORKS) checkExisting(f);
    console.log(`\n✅ check 通过: ${FORKS.length} 个 fork 产物标记齐全`);
    return;
  }
  const dirs = FORKS.map((f) => materializeOne(f));
  if (publish) {
    FORKS.forEach((f, i) => publishOne(f, dirs[i]));
    console.log(`\n✅ 已发布 ${FORKS.length} 个 fork 包`);
    console.log('  下一步: 把 package.json overrides 指向新 fork 版本, 并退役 patch.mjs 对应条目');
  } else {
    console.log(`\n✅ sync 完成: ${FORKS.length} 个 fork 已重建到 .forks-out/`);
    console.log('  加 --publish 发布; 或用 --materialize 明确落盘(默认已落盘)');
  }
}

try {
  main();
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
