#!/usr/bin/env node
// migrate-presets: 把旧机制(`$DSH_HOME/.agent-presets/<id>/`)的用户预设迁移到新机制。
//
// 背景: 0.1.7-rc.2 起 dsh 不再读取 `.agent-presets/` 目录(官方: "Nothing reads that directory
// any more"), agent 预设改为 `@deepseek-ai/dsh-agent-preset` 声明行、由 bundle patch 承载。
// 本脚本把每个旧预设目录转成一条声明行, 追加到 profile 的 patch 层
// (`profiles/<profile>/cordis.patch.yml`, 在 bundle 之后应用), 于是它们在预设花名册里
// 重新出现, 无需打包发布。
//
// 用法:
//   node scripts/migrate-presets.mjs                 # 预演(只打印将要写入的内容)
//   node scripts/migrate-presets.mjs --write         # 实际写入
//   node scripts/migrate-presets.mjs --write --profile web --home ~/.dsh
//
// 安全设计:
//   - 默认 dry-run; 写入时只替换自己那段带标记的内容, 用户其它编辑原样保留
//   - 与官方内置预设同名(standard/ptc/minimal/cordis)或与已迁移项重名的目录跳过
//   - 每个插件 name 先从 dsh 安装树核对(解析不到的会被列出, 迁移后该预设可能挂载失败)
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDshDir } from '../lib/locate.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const write = args.includes('--write');
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const HOME_DIR = opt('--home', process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'));
const PROFILE = opt('--profile', 'web');
const LEGACY_DIR = join(HOME_DIR, '.agent-presets');
const PROFILE_PATCH = join(HOME_DIR, 'profiles', PROFILE, 'cordis.patch.yml');
const DSH_DIR = locateDshDir(ROOT);
const NM = join(DSH_DIR, 'node_modules');
const SHIPPED = new Set(['standard', 'ptc', 'minimal', 'cordis']);
const BEGIN = '# ==== dsh-harmonyos: migrated legacy presets (auto-generated, do not edit) ====';
const END = '# ==== end dsh-harmonyos migrated legacy presets ====';

if (!existsSync(LEGACY_DIR)) {
  console.log(`没有旧预设目录(${LEGACY_DIR}) — 无需迁移`);
  process.exit(0);
}

/** 从 preset.yml 取简单的 key: value 字段。 */
function readMeta(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^(name|description|order):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/** 插件 name 是否能从 dsh 安装树解析(等价 require.resolve)。 */
function resolvable(name) {
  const seg = name.split('/');
  const pkg = name.startsWith('@') ? join(NM, seg[0], seg[1]) : join(NM, seg[0]);
  return existsSync(join(pkg, 'package.json'));
}

/**
 * 旧预设的 persona 用 `config.text`, 而当前 persona 的 schema 是
 * `{ prefix(必填), suffix, complete, includeRuntimeContext }` —— `text` 会让挂载失败。
 * 迁移时把 persona 行下的 `text:` 就地改名为 `prefix:`(内容原样保留)。
 */
function convertPersonaText(lines) {
  let row = '';
  let converted = 0;
  const out = lines.map((l) => {
    const idm = /^\s*- id:\s*(\S+)/.exec(l);
    if (idm) row = idm[1];
    const nm = /^\s*name:\s*'?(@[^'\s]+)'?/.exec(l);
    if (nm) row = nm[1];
    const tm = /^(\s*)text:\s*(.*)$/.exec(l);
    if (tm && row === '@deepseek-ai/dsh-persona') { converted += 1; return `${tm[1]}prefix: ${tm[2]}`; }
    return l;
  });
  return { lines: out, converted };
}

const yamlStr = (s) => (/^[\w\u4e00-\u9fa5][^:#]*$/.test(s) ? s : JSON.stringify(s));

const blocks = [];
const skipped = [];
for (const id of readdirSync(LEGACY_DIR).sort()) {
  const dir = join(LEGACY_DIR, id);
  const comp = join(dir, 'agent.cordis.yml');
  if (!existsSync(comp)) continue;
  if (SHIPPED.has(id)) { skipped.push(`${id}(与官方内置预设重名, 跳过)`); continue; }
  if (id === 'harmonyos-chat') { skipped.push(`${id}(已是内置 bundle, 跳过)`); continue; }
  const meta = readMeta(join(dir, 'preset.yml'));
  const body = readFileSync(comp, 'utf8').split('\n');
  const start = body.findIndex((l) => l.startsWith('- id:'));
  if (start < 0) { skipped.push(`${id}(组合文件里没有条目)`); continue; }
  const { lines: fixed, converted } = convertPersonaText(body.slice(start));
  if (converted) console.log(`  · ${id}: persona text → prefix(${converted} 处, 旧键会让挂载失败)`);
  const plugins = fixed.map((l) => (l.trim() === '' ? '' : '          ' + l)).join('\n').replace(/\s+$/, '');
  const names = [...new Set([...body.join('\n').matchAll(/name:\s*'(@[^']+)'/g)].map((m) => m[1]))];
  const bad = names.filter((n) => !resolvable(n));
  if (bad.length) skipped.push(`${id}(插件无法解析: ${bad.join(', ')} -> 迁移后会挂载失败, 已跳过)`);
  const head = [
    `    - id: preset-${id}`,
    `      name: '@deepseek-ai/dsh-agent-preset'`,
    '      config:',
    `        id: ${id}`,
    ...(meta.name ? [`        name: ${yamlStr(meta.name)}`] : []),
    ...(meta.description ? [`        description: ${yamlStr(meta.description)}`] : []),
    ...(meta.order ? [`        order: ${meta.order}`] : []),
    '        plugins:',
  ].join('\n');
  blocks.push(`${head}\n${plugins}`);
}

console.log(`旧预设目录: ${LEGACY_DIR}`);
console.log(`profile patch: ${PROFILE_PATCH}`);
console.log(`可迁移: ${blocks.length} 个 | 跳过: ${skipped.length} 个`);
for (const s of skipped) console.log('  - 跳过 ' + s);
if (!blocks.length) { console.log('没有可迁移的预设'); process.exit(0); }

const section = `${BEGIN}\n- insert:\n${blocks.join('\n\n')}\n${END}\n`;
console.log('\n=== 将写入的内容 ===');
console.log(section);

if (!write) { console.log('(预演模式; 加 --write 才会写入)'); process.exit(0); }

const prev = existsSync(PROFILE_PATCH) ? readFileSync(PROFILE_PATCH, 'utf8') : '[]\n';
const stripped = prev.includes(BEGIN) && prev.includes(END)
  ? prev.slice(0, prev.indexOf(BEGIN)) + prev.slice(prev.indexOf(END) + END.length + 1)
  : prev;
const next = stripped.replace(/\s*$/, '\n') + '\n' + section;
mkdirSync(dirname(PROFILE_PATCH), { recursive: true });
writeFileSync(PROFILE_PATCH, next);
console.log(`✅ 已写入 ${PROFILE_PATCH}`);
console.log('   重启 dsh 后, 这些预设会重新出现在预设花名册里。');
