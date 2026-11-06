#!/usr/bin/env node
// preset-sync: 从官方 `@deepseek-ai/dsh-web-app` 的 standard 预设重新生成我们的内置预设。
//
// 背景: 内置预设 `harmonyos-chat` 必须是官方 `standard` 的「逐行一致 + 仅改 persona」版本。
// 上游每次调整 standard(增删行、改配置、改段落措辞)都要跟着同步，手改极易漏(issue #5 就是
// 引用了上游已删除的包导致新会话挂载失败、前端只 console.warn)。
//
// 做法: **文本级**改写官方文件(不 round-trip YAML)——
//   · 官方文件的缩进、`!!js` 标签、注释位置全部原样保留, 我们只替换四处:
//       1. 声明行 id / 预设 id
//       2. 预设 name/description/order
//       3. persona 行的 config(换成鸿蒙运行环境 prefix)
//       4. 末尾追加 agent-preset-registry 的 default 覆盖
//   · round-trip js-yaml 会把 `!!js` 标签丢失(它不认得该 tag 的 dump 语义)且重排缩进,
//     所以这里坚持文本编辑。
//
// 用法:
//   node scripts/preset-sync.mjs [DSH_DIR]           # 生成/覆盖 presets/harmonyos-chat/cordis.patch.yml
//   node scripts/preset-sync.mjs [DSH_DIR] --check   # 只比对(CI 用), 有差异 exit 1
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDshDir } from '../lib/locate.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET = join(ROOT, 'presets', 'harmonyos-chat', 'cordis.patch.yml');
const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DSH_DIR = argDir || locateDshDir(ROOT);
const checkOnly = process.argv.includes('--check');

const PRESET_ID = 'harmonyos-chat';
const META = {
  name: '鸿蒙对话模式（内置提示词）',
  description: '基于标准模式的完整编码 Agent；系统提示词预置鸿蒙运行环境说明'
    + '（鸿蒙内核 / target=linux-aarch64-ohos / 与 Linux ABI 兼容但非 Linux / /tmp 只读 / $TMPDIR=~/.cache），开箱即用。',
  order: 10,
};
const PERSONA_LINES = [
  '你是运行在 HarmonyOS PC 上的编码 Agent，由 {{model}} 模型驱动。',
  '',
  '本机运行环境（重要，先读再动手）：',
  '- 操作系统为鸿蒙（HarmonyOS），采用鸿蒙内核，构建目标为 target=linux-aarch64-ohos。',
  '- 系统与 Linux ABI 兼容，但它不是 Linux：不得假设 glibc、x86 路径、Linux 发行版行为或未经验证的系统接口；'
    + '涉及系统调用、命令行与文件系统行为时，先实测再下结论。',
  '- /tmp 在本设备上是只读的。需要写临时文件时，改写到 $TMPDIR（本设备默认为 ~/.cache）或工作区内可写目录；'
    + '不要写 /tmp 等只读位置。',
  '- 修改文件前先读取；产生的副作用保持可逆（可清理、可回滚）。',
  '',
  '工作风格：先给结论，保持简洁；能一步完成的任务直接做，不铺张；避免长篇解释，除非用户明确要求。',
];
const HEADER = `# dsh-harmonyos 内置预设 \`${PRESET_ID}\` —— bundle 声明格式(0.1.7 起)。
#
# 本文件由 \`npm run preset-sync\` 从官方 \`@deepseek-ai/dsh-web-app\` 的
# presets/standard.patch.yml 生成：行清单/配置/注释与官方逐行一致，仅改预设标识
# (id/name/description/order)、persona 配置(鸿蒙运行环境说明)与末尾追加的
# agent-preset-registry.default 覆盖。**不要手改**，上游升级后重新跑 preset-sync。
#
# 机制: package.json 的 dsh.bundle.patch 指向本文件；启动器把本 bundle 包名写进
# profile 的 dsh.profile.bundles，每个新会话默认挂上它 = 系统提示词开箱自带。
# 用户 patch 层(profiles/<name>/cordis.patch.yml)在 bundle 之后应用，尊重用户选择。

`;

const srcPath = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml');
if (!existsSync(srcPath)) {
  console.error('✗ 找不到官方 standard 预设: ' + srcPath);
  process.exit(2);
}

/** 找到某行 id 的下标(同一行的 `- id: xxx`)。 */
function findRowIndex(lines, id, from = 0) {
  for (let i = from; i < lines.length; i += 1) if (lines[i].trim() === `- id: ${id}`) return i;
  return -1;
}

const out = readFileSync(srcPath, 'utf8').split('\n');

// 1) 声明行 id / 预设 id
const decl = findRowIndex(out, 'preset-standard');
if (decl < 0) { console.error('✗ 官方文件里找不到 `- id: preset-standard`'); process.exit(2); }
out[decl] = out[decl].replace('preset-standard', `preset-${PRESET_ID}`);
const declIndent = out[decl].match(/^\s*/)[0];
const cfgIndent = declIndent + '    ';
let cfgIdLine = -1;
for (let i = decl; i < out.length && i < decl + 20; i += 1) {
  if (out[i].trim() === 'id: standard') { cfgIdLine = i; break; }
  if (out[i].startsWith(declIndent) && i > decl && /^\s*- id: /.test(out[i]) && i > decl + 1) break;
}
if (cfgIdLine < 0) { console.error('✗ 找不到声明的 `id: standard`'); process.exit(2); }

// 2) 预设标识：把 `id/order` 两行换成 id/name/description/order
const orderLine = out.findIndex((l, i) => i > cfgIdLine && l.trim() === 'order: 1' && l.startsWith(cfgIndent));
if (orderLine < 0) { console.error('✗ 找不到 `order: 1`'); process.exit(2); }
out.splice(cfgIdLine, orderLine - cfgIdLine + 1,
  `${cfgIndent}id: ${PRESET_ID}`,
  `${cfgIndent}name: ${META.name}`,
  `${cfgIndent}description: ${META.description}`,
  `${cfgIndent}order: ${META.order}`);

// 3) persona 配置整体替换(保留 persona 行的 id/name 与缩进)
const personaRow = findRowIndex(out, 'persona');
if (personaRow < 0) { console.error('✗ 找不到 persona 行'); process.exit(2); }
const pRowIndent = out[personaRow].match(/^\s*/)[0];
const pNameLine = personaRow + 1;
const pConfigLine = personaRow + 2;
if (!out[pNameLine].includes('dsh-persona') || out[pConfigLine].trim() !== 'config:') {
  console.error('✗ persona 行结构与预期不符: ' + JSON.stringify(out.slice(personaRow, personaRow + 3)));
  process.exit(2);
}
const pCfgIndent = out[pConfigLine].match(/^\s*/)[0];
// 找到 persona config 块的结束(下一行缩进 <= persona 行缩进 且是 `- id:`)
let end = pConfigLine + 1;
while (end < out.length) {
  const l = out[end];
  if (l.trim() !== '' && l.match(/^\s*/)[0].length <= pRowIndent.length) break;
  end += 1;
}
// block scalar 内容必须比 key 缩进更深
const prefixKeyIndent = (pCfgIndent + '  ').length;
const contentIndent = ' '.repeat(prefixKeyIndent + 2);
const personaBlock = [
  `${pCfgIndent}config:`,
  `${pCfgIndent}  prefix: |-`,
  ...PERSONA_LINES.map((l) => (l === '' ? '' : contentIndent + l)),
];
out.splice(pConfigLine, end - pConfigLine, ...personaBlock);

// 4) 末尾追加 registry 默认覆盖
const body = out.join('\n').replace(/\s+$/, '');
const generated = `${HEADER}${body}\n\n`
  + '# 默认预设: 覆盖 web-app 插入的 agent-preset-registry 行(整份 config 替换, 需带全字段)。\n'
  + '- id: agent-preset-registry\n'
  + "  name: '@deepseek-ai/dsh-agent-preset-registry'\n"
  + '  config:\n'
  + `    default: ${PRESET_ID}\n`;

if (checkOnly) {
  const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
  const same = current.replace(/\s+$/, '') === generated.replace(/\s+$/, '');
  console.log(same
    ? '✅ 内置预设与官方 standard 一致'
    : '✗ 内置预设与官方 standard 有差异 — 跑 `npm run preset-sync` 重新生成');
  process.exit(same ? 0 : 1);
}

writeFileSync(TARGET, generated);
console.log('✅ 已从官方 standard 同步内置预设 → ' + TARGET);
