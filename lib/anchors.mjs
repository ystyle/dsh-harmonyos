#!/usr/bin/env node
// dsh-harmonyos 升级预检: 逐文件核对 patch.mjs 的补丁锚点。
//
// fork 之后(fork-overrides 方案): 已 fork 的包安装时自带改动标记(HarmonyOS patch 等),
// 锚点(原始上下文)核对对它无意义 —— 逐文件跳过; 残余(未 fork, 仍由 patch.mjs 兜底)锚点
// 必须全部命中。官方 dsh 升级后残余锚点漂移会在这里被拦下, 而不是装完才炸。
//
// 用法:
//   node lib/anchors.mjs [DSH_DIR]      # 默认本包所在树
//   DSH_OHOS_NODE=... node lib/anchors.mjs /path/to/staging
// 退出码: 0=残余锚点全部命中, 1=有失配(需人工适配), 2=目标树缺失(目录不对)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- 目标树定位(与 patch.mjs 同规则) ----
function locateDshDir() {
  let dir = dirname(dirname(fileURLToPath(import.meta.url)));
  for (let i = 0; i < 8 && dir !== dirname(dir); i += 1, dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return dir;
    if (basename(dir) === 'node_modules' && existsSync(join(dir, '@deepseek-ai', 'dsh', 'package.json'))) return dirname(dir);
  }
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
const DSH_DIR = process.argv[2] ? process.argv[2] : locateDshDir();
const NM = join(DSH_DIR, 'node_modules');

function locatePkgFiles(name, rel = 'lib/index.js') {
  const found = [];
  (function walk(dir, depth) {
    if (depth > 6) return;
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name === name) {
        const p = join(dir, e.name, rel);
        if (existsSync(p)) found.push(p);
        continue;
      }
      if (e.name !== '.bin') walk(join(dir, e.name), depth + 1);
    }
  })(NM, 0);
  return found;
}
function pkg(name, rel) {
  const all = locatePkgFiles(name, rel);
  return all.length ? all : [join(NM, '@deepseek-ai', name, rel ?? 'lib/index.js')];
}

// ---- 锚点表: 每条 = [标签, 文件, [锚点...]] ----
// 锚点可为字符串(子串) 或 RegExp。改动 patch.mjs 时必须同步此表。
// files: 某目标包的全部实例(npm 11 可能嵌套多份, 必须全部命中)。
function anchorSpecs() {
  const spec = [];
  const add = (label, files, anchors) => spec.push({ label, files, anchors });

  add('dsh-credentials-local::win32-guard', pkg('dsh-credentials-local'), [
    'if (process.platform === "win32") return;',
    '/* v8 ignore stop */',
  ]);
  add('dsh-session-persistence-jsonl::link→rename', pkg('dsh-session-persistence-jsonl'), [
    /(\t+)await link\(\s*tmp\s*,\s*finalPath\s*\);/,
    /(import\s*\{[^}]*?)\}\s*from\s*["']node:fs\/promises["'];/,
  ]);
  add('dsh-session-persistence-jsonl::publishCurrentExclusive 迁移发布', pkg('dsh-session-persistence-jsonl'), [
    /async function publishCurrentExclusive\(\s*staged\s*,\s*currentPath\s*,\s*internals\s*\)/,
    '\ttry {\n\t\tawait internals.fs.link(staged, currentPath);\n\t} catch (error) {\n\t\t/* v8 ignore else -- a non-collision filesystem error propagates unchanged. */\n\t\tif (isEEXIST(error)) return false;\n\t\t/* v8 ignore next -- the filesystem error is already complete. */\n\t\tthrow error;\n\t}',
  ]);
  add('dsh-permission-presets::shell→fs sandboxMode', pkg('dsh-permission-presets'), [
    /static\s+inject\s*=\s*(\[[^\]]*\])/,
    '"shell"',
    /ctx\.shell\.sandboxMode/,
  ]);
  add('dsh-attachment-local::补 copyFile import', pkg('dsh-attachment-local'), [
    /(import\s*\{\s*chmod,\s*)link(\s*,)/,
  ]);
  add('dsh-attachment-local::syncDirectory 挂载点 guard', pkg('dsh-attachment-local'), [
    '\t/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */\n\tconst handle = await open(path, constants.O_RDONLY);',
  ]);
  add('dsh-attachment-local::publishStaged link EPERM→rename', pkg('dsh-attachment-local'), [
    '\t\ttry {\n\t\t\tawait link(staged.path, target);\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n\t\t\tif (await digestFile(target) !== staged.sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n\t\t}\n\t\tawait unlink(staged.path);',
  ]);
  add('dsh-attachment-local::publishImmutableAlias 别名发布', pkg('dsh-attachment-local'), [
    /async function publishImmutableAlias\(\s*root\s*,\s*source\s*,\s*target\s*,\s*sha256\s*\)/,
    '\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n\t\t\tif (await digestFile(target) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");',
  ]);
  add('dsh-fs-local::createIfAbsent link→rename', pkg('dsh-fs-local'), [
    /([ \t]+)await throwGuardedCreateFailure\(error, absolutePath, createIfAbsent\.displayPath, inspectPublicationTarget\);/,
  ]);
  add('dsh-settings::恢复旧导出', pkg('dsh-settings'), [
    'export { SettingsConflictError, SettingsProvider, SettingsProvider as default, redactSecrets };',
  ]);
  add('dsh-client-connection::tokenMatches helper', pkg('dsh-client-connection'), [
    'function tokenMatches(actual, expected) {\n\tconst actualBytes = Buffer.from(actual, "utf8");\n\tconst expectedBytes = Buffer.from(expected, "utf8");\n\treturn actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes);\n}',
  ]);
  add('dsh-client-connection::token 交换内联 mint', pkg('dsh-client-connection'), [
    '\t\t\t\tconst issuedAt = Date.now();\n\t\t\t\tconst expiresAt = issuedAt + this.maxAgeMilliseconds;\n\t\t\t\tconst value = encodeCookie({\n\t\t\t\t\tversion: COOKIE_PAYLOAD_VERSION,\n\t\t\t\t\tauthority,\n\t\t\t\t\tissuedAt,\n\t\t\t\t\texpiresAt\n\t\t\t\t}, this.secret);\n\t\t\t\tres.writeHead(303, {\n\t\t\t\t\t"cache-control": "no-store",\n\t\t\t\t\t"location": "/",\n\t\t\t\t\t"referrer-policy": "no-referrer",\n\t\t\t\t\t"set-cookie": sessionCookie(cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1e3))\n\t\t\t\t});\n\t\t\t\tres.end();\n\t\t\t\treturn false;\n\t\t\t}',
  ]);
  add('dsh-client-connection::token 分支尾部', pkg('dsh-client-connection'), [
    '\t\t\tthis.writeUnauthorized(req, res);\n\t\t\treturn false;\n\t\t}\n\t\tif (this.isAuthenticated(req)) return true;',
  ]);
  add('dsh-client-connection::无 token 分支尾部', pkg('dsh-client-connection'), [
    '\t\tif (this.isAuthenticated(req)) return true;\n\t\tthis.writeUnauthorized(req, res);\n\t\treturn false;\n\t}',
  ]);
  // patchSandboxPolicy 走平铺路径(与 patch.mjs 一致)
  add('dsh-sandbox-policy::defaultMode', [join(NM, '@deepseek-ai', 'dsh-sandbox-policy', 'lib', 'index.js')], [
    'this.defaultMode = config.mode;',
  ]);
  add('dsh-tool-fs-search::DSH_RG_PATH', pkg('dsh-tool-fs-search'), [
    'return (await import("@vscode/ripgrep")).rgPath;',
  ]);
  add('node-addon-system::flock 原生绑定加载', pkg('node-addon-system', 'lib/flock.js'), [
    /const \{ platform, arch \} = process;/,
    /require\.resolve\(`@deepseek-ai\/node-addon-system-\$\{platform\}-\$\{arch\}\/package\.json`\)/,
    /binding = require\(join\(dirname\(manifest\), 'bin', filename\)\);/,
  ]);
  // dsh-client-resources: 浏览器加载的是 lib/client.js(非 lib/index.js), rel 需显式指定。
  add('dsh-client-resources::protocolOf 资源协议识别', pkg('dsh-client-resources', 'lib/client.js'), [
    'function protocolOf(address) {',
    'return parsed.hostname === "" ? void 0 : parsed.hostname.toLowerCase();',
  ]);
  return spec;
}

// 打补丁后的标记: 文件出现即说明该文件已被 patch.mjs 改过 / 已是 fork 包产物,
// 锚点(原始上下文)核对对它无意义 —— 逐文件跳过, 只核对残余(未 fork)锚点。
const PATCH_MARKERS = [
  'HarmonyOS patch',
  'HarmonyOS /storage mounts reject hard links',
  'HarmonyOS no-op memory flock',
  'DSH_RG_PATH',
  'DSH_OHOS_FORCE_DANGER',
];

function main() {
  console.log(`预检目标树: ${DSH_DIR}`);
  if (!existsSync(join(NM, '@deepseek-ai', 'dsh', 'package.json'))) {
    console.error(`✗ 未找到 ${join(NM, '@deepseek-ai', 'dsh', 'package.json')} — 目录不对?`);
    process.exit(2);
  }
  const dshVer = (() => { try { return JSON.parse(readFileSync(join(NM, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version; } catch { return '?'; } })();
  console.log(`官方 dsh 版本: ${dshVer}`);

  let failed = 0;
  let checked = 0;
  let skipped = 0;
  for (const { label, files, anchors } of anchorSpecs()) {
    for (const file of files) {
      if (!existsSync(file)) { console.log(`✗ ${label}: 文件缺失 ${file}`); failed += 1; continue; }
      const txt = readFileSync(file, 'utf8');
      if (PATCH_MARKERS.some((m) => txt.includes(m))) { skipped += 1; continue; }
      for (const a of anchors) {
        checked += 1;
        const ok = a instanceof RegExp ? a.test(txt) : txt.includes(a);
        if (!ok) {
          failed += 1;
          console.log(`✗ ${label}\n    文件: ${file}\n    锚点: ${JSON.stringify(String(a).slice(0, 120))}`);
        }
      }
    }
  }
  console.log('');
  if (failed === 0) {
    console.log(`✅ 核对 ${checked} 个残余锚点全部命中, 跳过 ${skipped} 个已 fork/已 patch 文件 — dsh@${dshVer}`);
    console.log('  fork 包(diff 即真值)自带改动标记, 无需锚点核对; 残余锚点保证 patch.mjs 兜底路径可用。');
    process.exit(0);
  }
  console.log(`❌ ${failed}/${checked} 处残余锚点失配`);
  console.log('      需按上面每处文件/锚点人工适配 patch.mjs 后再打补丁。');
  process.exit(1);
}

main();
