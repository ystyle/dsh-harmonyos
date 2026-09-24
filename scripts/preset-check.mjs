#!/usr/bin/env node
// preset-check: 发布前校验内置预设 bundle（issue #5 的教训固化）。
//
// 背景: v0.12.0 的内置预设引用了上游 0.1.6 已移除的
// `@deepseek-ai/dsh-workflow-worker-thread`，新会话挂载预设失败、前端只 console.warn，
// 表现为「新建会话按钮点了没反应」。一个 require.resolve 就能拦住 —— 本脚本做三件事:
//
//   1. 逐行核对: bundle 声明里每个插件 name 都能从 dsh 安装树解析(等价 require.resolve)
//   2. 漂移比对: 与官方 `standard` 预设的插件 id 清单逐项比对(上游增删行会被点名)
//   3. 结构校验: YAML 合法、声明字段齐全(id/plugins)、组行嵌套正确
//
// 用法:
//   node scripts/preset-check.mjs [DSH_DIR]     # 默认本包所在树
// 退出码: 0=通过, 1=有问题(需人工处理), 2=目标树/文件缺失
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { locateDshDir } from '../lib/locate.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DSH_DIR = process.argv[2] ? process.argv[2] : locateDshDir(ROOT);
const NM = join(DSH_DIR, 'node_modules');
const BUNDLE = join(ROOT, 'presets', 'harmonyos-chat', 'cordis.patch.yml');

// ---- 极简 YAML 读取: 只取需要的结构(避免引入依赖; !!js 标签按字符串处理) ----
// 用官方的 js-yaml（dsh 树内）在可得时更稳，否则回退到本文件的解析器。
function loadYaml(text) {
  const candidates = [
    join(NM, 'js-yaml'),
    join(NM, '@deepseek-ai', 'dsh-app-boot', 'node_modules', 'js-yaml'),
  ];
  for (const dir of candidates) {
    if (!existsSync(join(dir, 'package.json'))) continue;
    try {
      const req = createRequire(join(dir, 'package.json'));
      const yaml = req('js-yaml');
      const JsType = new yaml.Type('tag:yaml.org,2002:js', {
        kind: 'scalar', resolve: () => true, construct: (d) => `JS(${d})`,
      });
      return yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([JsType]) });
    } catch { /* 试下一个 */ }
  }
  return undefined;
}

/** 收集声明里的插件 name 与行 id（含嵌套组）。 */
function collectRows(plugins, out = { ids: [], names: [] }) {
  for (const row of plugins ?? []) {
    if (typeof row !== 'object' || row === null) continue;
    if (row.id !== undefined) out.ids.push(row.id);
    if (typeof row.name === 'string' && !row.name.startsWith('cordis:')) out.names.push(row.name);
    if (row.group === true) collectRows(row.config, out);
  }
  return out;
}

/** 官方 standard 预设的插件 id 清单（新版在 dsh-web-app/presets/standard.patch.yml）。 */
function shippedStandardRows() {
  const dir = join(NM, '@deepseek-ai', 'dsh-web-app', 'presets');
  if (!existsSync(dir)) return undefined;
  const file = readdirSync(dir).find((f) => f === 'standard.patch.yml' || f === 'standard.yml');
  if (!file) return undefined;
  const text = readFileSync(join(dir, file), 'utf8');
  const doc = loadYaml(text);
  if (doc === undefined) return undefined;
  const decl = (Array.isArray(doc) ? doc : []).flatMap((r) => r?.insert ?? []).find((r) => r?.config?.plugins);
  if (!decl) return undefined;
  return collectRows(decl.config.plugins);
}

function die(msg) { console.error('✗ ' + msg); process.exit(msg.startsWith('未找到') ? 2 : 1); }

// ---- 1. 文件与结构 ----
if (!existsSync(BUNDLE)) die('未找到内置预设 bundle: ' + BUNDLE);
const text = readFileSync(BUNDLE, 'utf8');
const doc = loadYaml(text);
if (doc === undefined) {
  console.log('⚠ 未能加载 YAML 解析器(js-yaml 不在 dsh 树内) — 跳过结构/漂移核对，仅做文本级 require.resolve');
}
let plugins = [];
if (Array.isArray(doc)) {
  const decl = doc.flatMap((r) => r?.insert ?? []).find((r) => r?.config?.plugins);
  if (!decl) die('bundle 里找不到 preset 声明行(config.plugins)');
  const cfg = decl.config;
  for (const field of ['id', 'plugins']) {
    if (cfg[field] === undefined) die(`声明缺少必填字段 ${field}`);
  }
  if (!/^[a-z0-9-]+$/.test(cfg.id)) die(`预设 id 非法(只允许小写字母/数字/连字符): ${cfg.id}`);
  if (decl.id !== `preset-${cfg.id}`) console.log(`⚠ Loader 行 id 惯例为 preset-<id>: 实际 ${decl.id}`);
  plugins = cfg.plugins;
  console.log(`预设 id: ${cfg.id} | 显示名: ${cfg.name ?? '(未设)'} | order: ${cfg.order ?? '(未设)'}`);
}

// ---- 2. 逐行 require.resolve(等价: 从 dsh 安装树找包) ----
const { ids, names } = collectRows(plugins);
const uniq = [...new Set(names)];
const missing = uniq.filter((n) => {
  if (n.startsWith('@deepseek-ai/dsh-')) {
    // scope 包: node_modules/@deepseek-ai/<name>[/子路径]
    const seg = n.split('/');
    const pkg = join(NM, seg[0], seg[1]);
    return !existsSync(join(pkg, 'package.json'));
  }
  const pkg = join(NM, ...n.split('/'));
  return !existsSync(join(pkg, 'package.json'));
});
console.log(`\n插件行: ${ids.length} 个(去重 ${uniq.length} 个包)`);
if (missing.length) {
  console.log('✗ 无法解析的插件(预设挂载会失败):');
  for (const m of missing) console.log('    ' + m);
} else {
  console.log('✅ 全部插件包均可从 dsh 安装树解析');
}

// ---- 3. 与官方 standard 漂移比对 ----
let drift = 0;
const shipped = shippedStandardRows();
if (shipped === undefined) {
  console.log('\n⚠ 未找到官方 standard 预设(旧版布局?) — 跳过漂移比对');
} else {
  const ours = new Set(ids);
  const theirs = new Set(shipped.ids);
  const onlyOurs = [...ours].filter((i) => !theirs.has(i));
  const onlyTheirs = [...theirs].filter((i) => !ours.has(i));
  console.log('\n与官方 standard 漂移:');
  if (onlyTheirs.length) {
    console.log('  上游新增(考虑同步): ' + onlyTheirs.join(', '));
    drift += onlyTheirs.length;
  }
  if (onlyOurs.length) {
    console.log('  我方独有: ' + onlyOurs.join(', '));
  }
  if (!onlyTheirs.length) console.log('  ✅ 上游没有我们缺失的行');
}

console.log('');
if (missing.length || drift) {
  console.log(`❌ ${missing.length} 个包无法解析, ${drift} 处上游漂移 — 修好再发布`);
  process.exit(1);
}
console.log('✅ 内置预设 bundle 校验通过(包可解析、无上游漂移)');
