#!/usr/bin/env node
// dsh-harmonyos 补丁引擎: patch(幂等打官方包源码) / check(查版本)。鸿蒙适配专用, 零依赖。
// 升级官方 dsh 的流程见 README: 仓库内改 pin → npm install → npm run patch && npm run prune。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDshDir } from './locate.mjs';

const HOME = homedir();
// dsh-harmonyos 发行包: 向上搜索定位 @deepseek-ai 目标树(npm 可能 staging/嵌套/flat), 见 lib/locate.mjs。
const DSH_DIR = locateDshDir(dirname(dirname(fileURLToPath(import.meta.url))));
if (!existsSync(join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')))
  console.error('警告: 未能定位 dsh 目标树(DSH_DIR=' + DSH_DIR + '), 补丁可能无效');
const PKG = locatePkgFile('dsh', 'package.json');
const LOG = join(HOME, 'dsh-update.log');
// npm 11 按版本冲突把 @deepseek-ai/* 嵌套进上层包(如 dsh-base/node_modules/@deepseek-ai/…)，
// 不再总是平铺在 DSH_DIR/node_modules/@deepseek-ai/。补丁定位改为按包名递归找真实路径。
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
        continue; // 同名包目录不再下钻
      }
      if (e.name !== '.bin') walk(join(dir, e.name), depth + 1);
    }
  })(join(DSH_DIR, 'node_modules'), 0);
  return found;
}
// 兼容旧用法: 返回第一个实例(或平铺兜底路径)。
function locatePkgFile(name, rel = 'lib/index.js') {
  const flat = join(DSH_DIR, 'node_modules', '@deepseek-ai', name, rel);
  if (existsSync(flat)) return flat;
  const all = locatePkgFiles(name, rel);
  return all[0] || flat;
}
// 某目标包的所有实例(可能多份: npm 嵌套布局)。补丁必须打全部, 否则 boot 加载到未打实例即挂。
function allInstances(name) {
  const all = locatePkgFiles(name);
  if (all.length) return all;
  const flat = join(DSH_DIR, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js');
  return [flat];
}
// dsh 实际运行用的 node: 强制要求 NODE_OHOS 环境变量(与 dsh-ohos 包装器同一约定)。
// 未配置直接报错, 不静默回落——补丁门控(如 cordisLoader v0)依赖运行时 node 能力, 环境不明宁可失败。
function runtimeNode() {
  const nodeBin = process.env.NODE_OHOS;
  if (!nodeBin) {
    console.error('patch.mjs: 未配置 NODE_OHOS 环境变量(需指向 node >= 22.16, 推荐 node26)。');
    console.error('  请配置: export NODE_OHOS="$HOME/.harmonybrew/opt/node/bin/node"');
    process.exit(1);
  }
  if (!existsSync(nodeBin)) {
    console.error('patch.mjs: NODE_OHOS 指向的 node 不存在: ' + nodeBin);
    process.exit(1);
  }
  return nodeBin;
}
// node >= 22.16 自带原生 zstd 与 v2 内部 loader: cordis-loader v0 补丁(zstd wasm 兼容层同理)
// 只在 node 22.7 时代必要。dsh 现在跑 node26, 直接跳过, 避免官方升级锚点失配卡住。
function runtimeNodeHasNativeZstd() {
  try {
    const r = spawnSync(runtimeNode(), ['-e', 'process.stdout.write(typeof require("node:zlib").zstdDecompressSync)'], { encoding: 'utf8', timeout: 15000 });
    return /^function/.test((r.stdout || '').trim());
  } catch { return false; }
}
const RUNTIME_HAS_NATIVE_ZSTD = runtimeNodeHasNativeZstd();
const CRED_FILE = locatePkgFile('dsh-credentials-local');
const SESS_FILE = locatePkgFile('dsh-session-persistence-jsonl');
const PERM_FILE = locatePkgFile('dsh-permission-presets');
const ATTACH_FILE = locatePkgFile('dsh-attachment-local');
// 工作区新文件写入(create-if-absent)走硬链接发布，鸿蒙 /storage 挂载对 link() 报 EPERM，
// 即使目标不存在也失败；补丁在确认目标缺失后改按 rename 发布，保住 create-if-absent 语义。
// 官方 alpha.2/alpha.3 均未含此兜底，升级重装会被冲掉，故必须纳入 patchAll 幂等重打。
const FS_LOCAL_FILE = locatePkgFile('dsh-fs-local');
// 0.1.2-alpha.2 起官方把裸插件名解析交给 node 内部 ESM loader(internal.import(name, baseUrl))；
// 鸿蒙自带 node v22.7.0 的内部 loader 既无 getOrCreateModuleJob 也无 getModuleJobForImport，
// ModuleLoader.fromInternal() 因此判定 shape 未知并返回 undefined → 裸插件名从 dsh-test 解析，
// profile 里另装的社区插件全线 "Cannot find package"。node26 原生 loader 无此问题, 已门控跳过。
const CORDIS_LOADER_FILE = locatePkgFile('cordis-plugin-loader');
// 0.1.2-alpha.2 重设计 dsh-settings：移除 installSettingsSection / settingsNamespace 导出，迁至
// SettingsProvider.installSection。社区插件(dsh-harmonyos-market/dshmarket/dsh-visual-plugin/
// dsh-knowledge-base/dsh-workstation/dsh-hiboard-push)仍按旧 API 导入，需加兼容垫片。
const SETTINGS_FILE = locatePkgFile('dsh-settings');
// dsh web 认证：0.1.2-alpha.2 每次进程启动都换新 launch token，本机新标签页/收藏夹的裸地址
// http://127.0.0.1:3080 永远 401「authentication required」。回环地址改为免 token 自动签发 cookie。
const CONN_FILE = locatePkgFile('dsh-client-connection');
// dsh-visual-plugin（第三方，github.com/jyh20030112/dsh-visual-plugin）以源码形式落在 profile 树，
// 经 dsh-hm-install.mjs 铺进 plugins-src 并软链到 node_modules；运行时入口是 lib/index.js。
const VISUAL_FILE = join(HOME, '.dsh', 'profiles', 'web', 'plugins-src', 'dsh-visual-plugin', 'lib', 'index.js');
const MARK = 'HarmonyOS patch';
const __dirname = dirname(fileURLToPath(import.meta.url));

// 幂等判定辅助。历史教训: 早期各补丁用「文件含 MARK 就整体跳过」做幂等, 这在**同文件多点补丁**时
// 会出致命问题 —— 标记由第 1 点带入, 第 2 点(哪怕手工局部回退过)就永远补不上, 且 boot 照常通过,
// 直到运行到那条代码路径才炸(0.1.5-rc.1 的会话迁移 EPERM 就是这么来的)。
// 改为按**该点自己的标记**判定: 单点补丁等价, 多点补丁各点独立成立。
function hasPatch(txt, tag) { return txt.includes(MARK + ': ' + tag); }

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  try { appendFileSync(LOG, line + '\n'); } catch {}
  console.log(parts.join(' '));
}
function tail(s, n = 6000) { return (s || '').slice(-n); }
function readFileSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

function sh(cmd, args, opts = {}) {
  args = args.concat(opts.extra || []);
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: opts.timeout ?? 600000, cwd: opts.cwd, env: { ...process.env, CI: 'true' },
  });
  return { ok: r.status === 0, code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// 鸿蒙适配：--ignore-scripts 跳过原生构建（koffi 需 CMake 但本机无编译器，
// 且其原生二进制只在 win32 路径使用、node-pty 本机本就不可用、sharp 走预编译）。
// 纯 JS 的 @deepseek-ai 包均无 install 脚本，忽略是安全的。
function npm(...args) { return sh('npm', args, { cwd: DSH_DIR, extra: ['--ignore-scripts'] }); }

function readInstalled() {
  try { return String(JSON.parse(readFileSync(PKG, 'utf8')).version || '').trim(); }
  catch { return ''; }
}
// 官方 dist-tags.latest 可能滞后于实际发布（如 rc.8 已发布而 latest 停在 rc.7），
// 因此遍历 versions 取数值最高的版本。版本解析为 5 元组 [maj,min,pa,stage,pre]：
// alpha=1 / rc=2 / 正式版=3，使 dsh-v0.1.2-alpha.2 这类 alpha 预发布也能正确参与比较。
function getLatest() {
  const r = npm('view', '@deepseek-ai/dsh', 'versions', '--json');
  if (!r.ok) throw new Error('npm view 失败: ' + tail(r.out));
  let list = [];
  try { list = JSON.parse(r.out.trim()); } catch {}
  if (!Array.isArray(list) || !list.length) throw new Error('npm 未返回可用版本列表: ' + tail(r.out));
  const nums = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|rc)\.(\d+))?/.exec(String(v).trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === 'alpha' ? 1 : m[4] === 'rc' ? 2 : 3, Number(m[5] || 0)] : null;
  };
  const sorted = list.filter((v) => nums(v)).sort((a, b) => {
    const A = nums(a), B = nums(b);
    for (let i = 0; i < 5; i++) if (A[i] !== B[i]) return A[i] - B[i];
    return 0;
  });
  return sorted[sorted.length - 1] || '';
}
export function check() {
  const installed = readInstalled();
  const latest = getLatest();
  return { installed, latest, upToDate: !!installed && installed === latest };
}

// ---- 幂等补丁 ----
function patchCredentials(file = CRED_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('credentials 文件不存在，需手动处理: ' + file);
  if (hasPatch(txt, "文件系统强制组位")) return { changed: false };
  const anchor = 'if (process.platform === "win32") return;';
  const stop = '/* v8 ignore stop */';
  const ai = txt.indexOf(anchor);
  if (ai === -1) throw new Error('credentials 补丁锚点缺失(win32 guard)，需手动处理: ' + file);
  const si = txt.indexOf(stop, ai);
  if (si === -1) throw new Error('credentials 补丁锚点缺失(v8 ignore stop)，需手动处理: ' + file);
  const block =
    anchor + '\n' +
    '\t/* HarmonyOS patch: 文件系统强制组位(chmod 600 被拒)，所有者检查在此必然抛错，跳过。 */\n' +
    '\treturn;\n';
  writeFileSync(file, txt.slice(0, ai) + block + txt.slice(si));
  return { changed: true };
}
function patchSession(file = SESS_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('session 文件不存在，需手动处理: ' + file);
  let patched = txt;

  // 1) 新会话首次落盘(materializePosix)：原为 link(tmp, finalPath) 独占发布，/storage 挂载对 link() 报 EPERM。
  //    注意不能再用「文件含 MARK 就整体跳过」做幂等判断：0.1.5-rc.1 起同一个文件里还有第二条 link 发布路径，
  //    整体跳过会让迁移路径永远漏补(2026-09-10 实测 resume v2 会话报 EPERM)。改为逐点判断。
  if (!patched.includes('link→rename')) {
    const re = /(\t+)await link\(\s*tmp\s*,\s*finalPath\s*\);/;
    const m = re.exec(patched);
    if (!m) throw new Error('session 补丁锚点缺失(await link(tmp, finalPath))，需手动处理: ' + file);
    patched = patched.slice(0, m.index) +
      m[1] + '/* HarmonyOS patch: 本机不支持硬链接(EPERM)，link→rename */\n' +
      m[1] + 'await rename(tmp, finalPath);' +
      patched.slice(m.index + m[0].length);
  }

  // 2) 历史会话迁移(publishCurrentExclusive)：v2→v3 迁移经 internals.fs.link 独占发布，
  //    同一挂载同样 EPERM(即使目标不存在)，补 rename 回退；先探测目标是否存在，保住独占语义。
  if (patched.includes('async function publishCurrentExclusive(') && !patched.includes('HarmonyOS patch: publishCurrentExclusive')) {
    const block =
      '\ttry {\n' +
      '\t\tawait internals.fs.link(staged, currentPath);\n' +
      '\t} catch (error) {\n' +
      '\t\t/* v8 ignore else -- a non-collision filesystem error propagates unchanged. */\n' +
      '\t\tif (isEEXIST(error)) return false;\n' +
      '\t\t/* v8 ignore next -- the filesystem error is already complete. */\n' +
      '\t\tthrow error;\n' +
      '\t}';
    if (!patched.includes(block)) throw new Error('session 补丁锚点缺失(publishCurrentExclusive link 段)，需手动处理: ' + file);
    patched = patched.replace(block,
      '\t/* HarmonyOS patch: publishCurrentExclusive —— /storage 挂载对 link() 报 EPERM，改按 rename 发布； */\n' +
      '\t/* 目标已存在时返回 false(独占语义)，缺失才 rename。 */\n' +
      '\ttry {\n' +
      '\t\tawait internals.fs.link(staged, currentPath);\n' +
      '\t} catch (error) {\n' +
      '\t\tif (isEEXIST(error)) return false;\n' +
      '\t\t/* v8 ignore next -- the filesystem error is already complete. */\n' +
      '\t\tif (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;\n' +
      '\t\tlet existed = true;\n' +
      '\t\ttry {\n' +
      '\t\t\tawait internals.fs.lstat(currentPath);\n' +
      '\t\t} catch (probeError) {\n' +
      '\t\t\t/* v8 ignore next -- 仅目标缺失(ENOENT)才继续 rename，其余错误如实上抛。 */\n' +
      '\t\t\tif (!(probeError instanceof Error && "code" in probeError && probeError.code === "ENOENT")) throw probeError;\n' +
      '\t\t\texisted = false;\n' +
      '\t\t}\n' +
      '\t\tif (existed) return false;\n' +
      '\t\tawait rename(staged, currentPath);\n' +
      '\t}');
  }

  // 仅换调用不补 import 会 ReferenceError(rename is not defined)：新 dsh 版本 fs/promises import 只含 link，
  // 必须在 import 解构里补上 rename（否则每次会话落盘/迁移都炸）。
  const im = /(import\s*\{[^}]*?)\}\s*from\s*["']node:fs\/promises["'];/.exec(patched);
  if (im && !/\brename\b/.test(im[1])) {
    patched = patched.slice(0, im.index + im[1].length) + ', rename' + patched.slice(im.index + im[1].length);
  }

  if (patched === txt) return { changed: false };
  writeFileSync(file, patched);
  return { changed: true };
}
function patchPermission(file = PERM_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('permission-presets 文件不存在，需手动处理: ' + file);
  if (hasPatch(txt, "无 bash shell")) return { changed: false };
  // 前置条件：此版本仍把 sandboxMode 读自 bash shell（fs 沙箱未启用时该字段不存在，patch 才需要）。
  // 若上游改读 ctx.fs.sandboxMode 或其他来源，锚点会失败并提示人工确认，绝不静默打错。
  const injRe = /static\s+inject\s*=\s*(\[[^\]]*\])/;
  const injM = injRe.exec(txt);
  if (!injM || !injM[1].includes('"shell"')) {
    throw new Error('permission 补丁锚点缺失(inject 数组无 "shell")，需手动处理: ' + file);
  }
  if (!/ctx\.shell\.sandboxMode/.test(txt)) {
    throw new Error('permission 补丁锚点缺失(ctx.shell.sandboxMode)，需手动处理: ' + file);
  }
  const newInject = injM[1].replace('"shell"', '"fs"');
  // 先替换 this.ctx.shell. 形式（其包含 ctx.shell. 子串），再替换剩余直接引用。
  let patched = txt
    .replace(/this\.ctx\.shell\.sandboxMode/g, 'this.ctx.fs.sandboxMode')
    .replace(/ctx\.shell\.sandboxMode/g, 'ctx.fs.sandboxMode');
  patched = patched.slice(0, injM.index) +
    '/* HarmonyOS patch: 无 bash shell(沙箱原生依赖被禁)，改用 fs 沙箱的 sandboxMode(纯 JS，在运行) */\n\tstatic inject = ' + newInject +
    patched.slice(injM.index + injM[0].length);
  writeFileSync(file, patched);
  return { changed: true };
}
// read_image 持久化：dsh-attachment-local 在本机(Android/HarmonyOS 存储)对 link() 报 EPERM，
// 且部分挂载点/目录无法以只读句柄打开(EPERM/EACCES/ENOTSUP)。syncDirectory 增挂载点 guard，
// link 失败时改按 copy 发布(EEXIST 竞态走完整性校验)。补 copyFile import。
function patchAttachment(file = ATTACH_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('attachment-local 文件不存在，需手动处理: ' + file);
  if (hasPatch(txt, "部分挂载点/目录无法以只读句柄打开")) return { changed: false };
  let patched = txt;
  // 1) import 补 copyFile（仅当干净 import 无 copyFile 时替换，幂等）。
  const impRe = /(import\s*\{\s*chmod,\s*)link(\s*,)/;
  const im = impRe.exec(patched);
  if (im) patched = patched.slice(0, im.index) + im[1] + 'copyFile, link' + im[2] + patched.slice(im.index + im[0].length);
  // 2) syncDirectory 挂载点 guard：把「直接 open 只读句柄」换成 try/catch 容错。
  const syncAnchor = '\t/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */\n\tconst handle = await open(path, constants.O_RDONLY);';
  if (patched.includes(syncAnchor)) {
    patched = patched.replace(syncAnchor,
      '\t/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */\n' +
      '\t/* HarmonyOS patch: 部分挂载点/目录无法以只读句柄打开(EPERM/EACCES/ENOTSUP)，跳过该次 fsync，持久化归挂载所有者。 */\n' +
      '\tlet handle;\n' +
      '\ttry {\n' +
      '\t\thandle = await open(path, constants.O_RDONLY);\n' +
      '\t} catch (error) {\n' +
      '\t\t/* v8 ignore next -- 无法 fsync 的边界走 return，不再上抛。 */\n' +
      '\t\tif (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;\n' +
      '\t\t/* v8 ignore next -- 其余错误如实上抛。 */\n' +
      '\t\tthrow error;\n' +
      '\t}');
  } else if (!patched.includes('let handle;\n\t\t\thandle = await open(path, constants.O_RDONLY)')) {
    throw new Error('attachment 补丁锚点缺失(syncDirectory 只读句柄)，需手动处理: ' + file);
  }
  // 3) link EPERM → rename 回退。0.1.3-alpha.2 重构为 publishStagedObject：staged 文件与本机同文件系统
  //    (都在 DSH_HOME/attachments/v1 下)，EPERM 时 rename 即可原子发布，无需跨盘 copy。
  const linkAnchor = '\t\ttry {\n\t\t\tawait link(staged.path, target);\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n\t\t\tif (await digestFile(target) !== staged.sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n\t\t}\n\t\tawait unlink(staged.path);';
  if (patched.includes(linkAnchor)) {
    patched = patched.replace(linkAnchor,
      '\t\ttry {\n' +
      '\t\t\tawait link(staged.path, target);\n' +
      '\t\t} catch (error) {\n' +
      '\t\t\t/* HarmonyOS patch: /storage 挂载对 link() 报 EPERM, 改按 rename 发布(staged 同文件系统已 durable)。 */\n' +
      '\t\t\tif (error instanceof Error && "code" in error && error.code === "EPERM") {\n' +
      '\t\t\t\ttry {\n' +
      '\t\t\t\t\tawait rename(staged.path, target);\n' +
      '\t\t\t\t} catch (renameError) {\n' +
      '\t\t\t\t\t/* v8 ignore next -- rename 竞态: EEXIST 即视为已发布, 校验完整性。 */\n' +
      '\t\t\t\t\tif (!(renameError instanceof Error && "code" in renameError && renameError.code === "EEXIST")) throw renameError;\n' +
      '\t\t\t\t\tif (await digestFile(target) !== staged.sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n' +
      '\t\t\t\t}\n' +
      '\t\t\t} else {\n' +
      '\t\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n' +
      '\t\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n' +
      '\t\t\t\tif (await digestFile(target) !== staged.sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n' +
      '\t\t\t}\n' +
      '\t\t}\n' +
      '\t\tawait unlink(staged.path).catch(() => {});');
  } else if (!patched.includes('HarmonyOS patch: /storage 挂载对 link() 报 EPERM')) {
    throw new Error('attachment 补丁锚点缺失(publishStagedObject link 段)，需手动处理: ' + file);
  }
  writeFileSync(file, patched);
  return { changed: true };
}
// 工作区新文件写入：dsh-fs-local 在 createIfAbsent 分支先 link() 再 fallback，本机(Android/HarmonyOS
// 存储)对 link() 报 EPERM 且目标不存在也报错，导致新文件写入直接炸。先查目标是否已存在：
// 存在则该抛 create 冲突(原 throwGuardedCreateFailure 语义)，不存在则改按 rename 发布。
function patchAttachmentAlias(file = ATTACH_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('attachment-local 文件不存在，需手动处理: ' + file);
  if (!txt.includes('async function publishImmutableAlias(')) return { changed: false, skipped: '该版本无 publishImmutableAlias' };
  if (txt.includes('HarmonyOS patch: publishImmutableAlias')) return { changed: false };
  // publishImmutableAlias(文件附件别名)同样走 link 发布，但 source 是内容寻址原件，不能像 staged 那样
  // rename 移走；/storage EPERM 时改用 copyFile(COPYFILE_EXCL) 复制别名，保留 EEXIST 竞态语义。
  const anchor =
    '\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n' +
    '\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n' +
    '\t\t\tif (await digestFile(target) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");';
  if (!txt.includes(anchor)) throw new Error('attachment 补丁锚点缺失(publishImmutableAlias link 段)，需手动处理: ' + file);
  let patched = txt.replace(anchor,
    '\t\t\t/* HarmonyOS patch: publishImmutableAlias —— /storage 挂载对 link() 报 EPERM，改用 copyFile(COPYFILE_EXCL) 复制别名；*/\n' +
    '\t\t\t/* source 是内容寻址原件，不能被 rename 移走，故只能复制。 */\n' +
    '\t\t\tif (error instanceof Error && "code" in error && error.code === "EPERM") {\n' +
    '\t\t\t\ttry {\n' +
    '\t\t\t\t\tawait copyFile(source, target, constants.COPYFILE_EXCL);\n' +
    '\t\t\t\t} catch (copyError) {\n' +
    '\t\t\t\t\t/* v8 ignore next -- copy 竞态: EEXIST 视为已发布, 校验完整性。 */\n' +
    '\t\t\t\t\tif (!(copyError instanceof Error && "code" in copyError && copyError.code === "EEXIST")) throw copyError;\n' +
    '\t\t\t\t\tif (await digestFile(target) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n' +
    '\t\t\t\t}\n' +
    '\t\t\t} else {\n' +
    '\t\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n' +
    '\t\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n' +
    '\t\t\t\tif (await digestFile(target) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n' +
    '\t\t\t}');
  // copyFile 正常由 patchAttachment 先补入；此处兜底，保证本函数单独运行也成立。
  const imp = /(import\s*\{[^}]*?)\}\s*from\s*["']node:fs\/promises["'];/.exec(patched);
  if (imp && !/\bcopyFile\b/.test(imp[1])) {
    patched = patched.slice(0, imp.index + imp[1].length) + ', copyFile' + patched.slice(imp.index + imp[1].length);
  }
  writeFileSync(file, patched);
  return { changed: true };
}
function patchFsLocal(file = FS_LOCAL_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('fs-local 文件不存在，需手动处理: ' + file);
  // 幂等：本补丁专用的可读注释作为标记（用大写的 HarmonyOS 前缀与其它补丁区分）。
  if (txt.includes('HarmonyOS /storage mounts reject hard links')) return { changed: false };
  const re = /([ \t]+)await throwGuardedCreateFailure\(error, absolutePath, createIfAbsent\.displayPath, inspectPublicationTarget\);/;
  const m = re.exec(txt);
  if (!m) throw new Error('fs-local 补丁锚点缺失(throwGuardedCreateFailure createIfAbsent)，需手动处理: ' + file);
  const ind = m[1];
  const block = ind + 'let existing;\n' +
    ind + 'try {\n' +
    ind + '\texisting = await inspectPublicationTarget(absolutePath);\n' +
    ind + '} catch (metadataError) {\n' +
    ind + '\tif (!isENOENT(metadataError) && !isENOTDIR(metadataError)) throw new FsError(`cannot write "${createIfAbsent.displayPath}": ${errorMessage(metadataError)}`, "FS_IO_ERROR", { cause: metadataError });\n' +
    ind + '}\n' +
    ind + 'if (existing !== void 0) {\n' +
    ind + '\tawait throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget);\n' +
    ind + '}\n' +
    ind + '// HarmonyOS /storage mounts reject hard links with EPERM even for\n' +
    ind + '// absent targets; publish via rename instead (target absence was\n' +
    ind + '// just verified, so create-if-absent semantics are preserved).\n' +
    ind + 'await rename(tempPath, absolutePath);';
  writeFileSync(file, txt.replace(re, block));
  return { changed: true };
}
function patchVision() {
  const txt = readFileSafe(VISUAL_FILE);
  if (!txt) throw new Error('dsh-visual-plugin 入口不存在，需手动处理: ' + VISUAL_FILE);
  if (hasPatch(txt, "视觉面板未配置时回退到主 DeepSeek 视觉模型")) return { changed: false };
  let patched = txt;
  // 1) 面板未配置时的回退常量（紧跟 DEFAULT_API_KEY_ENV 之后）。
  const constAnchor = 'const DEFAULT_API_KEY_ENV = "VISION_API_KEY";';
  if (patched.includes(constAnchor) && !patched.includes('const FALLBACK_VISION_MODEL')) {
    patched = patched.replace(constAnchor, constAnchor + '\n' +
      '/* HarmonyOS patch: 视觉面板未配置时回退到主 DeepSeek 视觉模型 + 同一密钥。 */\n' +
      'const FALLBACK_VISION_MODEL = "deepseek-v4-flash-vision-exp";\n' +
      'const DEEPSEEK_PROVIDER_NS = settingsNamespace("llm-deepseek");\n' +
      'const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";\n' +
      'const DEEPSEEK_BASE_URL = "https://api.deepseek.com";');
  }
  // 2) resolvedFacts：面板配置为空时回退到 llm-deepseek 的 baseURL/凭据引用 + 主视觉模型。
  const factsAnchor = '\t\tif (url.length === 0 || model.length === 0) return void 0;\n' +
    '\t\tconst apiKeyEnv = value?.apiKeyEnv ?? "VISION_API_KEY";\n' +
    '\t\tconst resolved = await credentials.resolve(credentialRef(apiKeyEnv));\n' +
    '\t\tif (resolved === void 0) return void 0;\n' +
    '\t\treturn {\n' +
    '\t\t\turl,\n' +
    '\t\t\tmodel,\n' +
    '\t\t\tapiKey: resolved.value\n' +
    '\t\t};';
  if (patched.includes(factsAnchor)) {
    patched = patched.replace(factsAnchor,
      '\t\tif (url.length > 0 && model.length > 0) {\n' +
      '\t\t\tconst apiKeyEnv = value?.apiKeyEnv ?? "VISION_API_KEY";\n' +
      '\t\t\tconst resolved = await credentials.resolve(credentialRef(apiKeyEnv));\n' +
      '\t\t\tif (resolved !== void 0) return {\n' +
      '\t\t\t\turl,\n' +
      '\t\t\t\tmodel,\n' +
      '\t\t\t\tapiKey: resolved.value\n' +
      '\t\t\t};\n' +
      '\t\t}\n' +
      '\t\t/* HarmonyOS patch: 面板未配置时回退到主 DeepSeek 视觉模型，复用 llm-deepseek 的 baseURL 与凭据引用。 */\n' +
      '\t\tconst deepseek = settings.get(DEEPSEEK_PROVIDER_NS) ?? {};\n' +
      '\t\tconst fallbackBaseUrl = typeof deepseek.baseURL === "string" && deepseek.baseURL.length > 0 ? deepseek.baseURL : DEEPSEEK_BASE_URL;\n' +
      '\t\tconst fallbackApiKeyEnv = typeof deepseek.apiKeyEnv === "string" && deepseek.apiKeyEnv.length > 0 ? deepseek.apiKeyEnv : DEEPSEEK_API_KEY_ENV;\n' +
      '\t\tconst fallbackKey = await credentials.resolve(credentialRef(fallbackApiKeyEnv));\n' +
      '\t\tif (fallbackKey === void 0) return void 0;\n' +
      '\t\treturn {\n' +
      '\t\t\turl: fallbackBaseUrl,\n' +
      '\t\t\tmodel: FALLBACK_VISION_MODEL,\n' +
      '\t\t\tapiKey: fallbackKey.value\n' +
      '\t\t};');
  } else if (!patched.includes('const deepseek = settings.get(DEEPSEEK_PROVIDER_NS)')) {
    throw new Error('vision 补丁锚点缺失(resolvedFacts)，需手动处理: ' + VISUAL_FILE);
  }
  // 3) describeImage：空 content(PROTOCOL)重试一次，仍空则降级为明确提示而非硬抛。
  const descAnchor = '\tconst result = await callChatCompletions(completionsUrl(baseUrl), apiKey, model, messages, signal);\n' +
    '\tconst describe = { description: result.content };\n' +
    '\tif (result.usage !== void 0) describe.usage = result.usage;\n' +
    '\treturn describe;';
  if (patched.includes(descAnchor)) {
    patched = patched.replace(descAnchor,
      '\t/* HarmonyOS patch: 自定义 prompt 偶发返回空 content，重试一次；仍为空则降级为明确提示而非硬抛。 */\n' +
      '\tconst url = completionsUrl(baseUrl);\n' +
      '\tconst describeOf = (result) => result.usage !== void 0 ? { description: result.content, usage: result.usage } : { description: result.content };\n' +
      '\tlet lastError;\n' +
      '\tfor (let attempt = 0; attempt < 2; attempt += 1) {\n' +
      '\t\ttry {\n' +
      '\t\t\treturn describeOf(await callChatCompletions(url, apiKey, model, messages, signal));\n' +
      '\t\t} catch (error) {\n' +
      '\t\t\tif (!(error instanceof VisionError && error.code === "PROTOCOL")) throw error;\n' +
      '\t\t\tlastError = error;\n' +
      '\t\t}\n' +
      '\t}\n' +
      '\tif (lastError !== void 0) return { description: "（视觉模型未返回内容，请重试或换个问法）" };\n' +
      '\treturn { description: "（视觉模型未返回内容）" };');
  } else if (!patched.includes('const describeOf = (result) =>')) {
    throw new Error('vision 补丁锚点缺失(describeImage)，需手动处理: ' + VISUAL_FILE);
  }
  writeFileSync(VISUAL_FILE, patched);
  return { changed: true };
}
// node 内部 ESM loader 形状识别：v2(getOrCreateModuleJob) / v1(getModuleJobForImport) 之外，
// 还要兜底识别仅有 import/resolve/loadCache 的 legacy loader（node 22.7.0 鸿蒙自带）。
// 否则 internal=undefined，profile 插件无法从 profile 目录解析，dsh 启动直接崩。
function patchCordisLoader() {
  const txt = readFileSafe(CORDIS_LOADER_FILE);
  if (!txt) throw new Error('cordis-plugin-loader 文件不存在，需手动处理: ' + CORDIS_LOADER_FILE);
  if (hasPatch(txt, "node v22.7.0 内部 loader")) return { changed: false };
  const anchor = 'const version = typeof raw.getOrCreateModuleJob === "function" ? "v2" : typeof raw.getModuleJobForImport === "function" ? "v1" : void 0;';
  if (!txt.includes(anchor)) throw new Error('cordis-loader 补丁锚点缺失(version shape)，需手动处理: ' + CORDIS_LOADER_FILE);
  const replacement =
    '/* HarmonyOS patch: node v22.7.0 内部 loader 无 getOrCreateModuleJob/getModuleJobForImport，\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t * 官方识别返回 undefined 导致裸插件名从 dsh-test 解析 fail；有 import 即为可用 legacy loader，补 v0。 */\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\tconst version = typeof raw.getOrCreateModuleJob === "function" ? "v2" : typeof raw.getModuleJobForImport === "function" ? "v1" : typeof raw.import === "function" ? "v0" : void 0;';
  writeFileSync(CORDIS_LOADER_FILE, txt.split(anchor).join(replacement));
  return { changed: true };
}
// 恢复 dsh-settings 旧导出(settingsNamespace/installSettingsSection)，委托给新版
// SettingsProvider.installSection，让沿用旧 API 的社区插件无需改源码即可在 0.1.2-alpha.2 运行。
function patchSettingsCompat(file = SETTINGS_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('dsh-settings 文件不存在，需手动处理: ' + file);
  if (hasPatch(txt, "restore exports removed upstream")) return { changed: false };
  const anchor = 'export { SettingsConflictError, SettingsProvider, SettingsProvider as default, redactSecrets };';
  if (!txt.includes(anchor)) throw new Error('dsh-settings 补丁锚点缺失(export 行)，需手动处理: ' + file);
  const block =
    '\n//#region HarmonyOS patch: restore exports removed upstream in 0.1.2-alpha.2\n' +
    '// settingsNamespace 是命名空间品牌化助手；installSettingsSection 迁入 SettingsProvider.installSection。\n' +
    '// 社区插件(dsh-harmonyos-market/dshmarket/dsh-visual-plugin/dsh-knowledge-base/dsh-workstation/dsh-hiboard-push)\n' +
    '// 仍按旧 API 导入，保持可用。\n' +
    'function settingsNamespace(value) {\n' +
    '\tif (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);\n' +
    '\treturn value;\n' +
    '}\n' +
    'function installSettingsSection(ctx, ns, schema, entry, hooks) {\n' +
    '\tctx.inject(["settings"], (sctx) => {\n' +
    '\t\tsctx.settings.installSection(ctx, ns, schema, entry, hooks);\n' +
    '\t});\n' +
    '}\n' +
    '//#endregion\n';
  const replacement = 'export { SettingsConflictError, SettingsProvider, SettingsProvider as default, deepEqualJson, installSettingsSection, redactSecrets, settingsNamespace };';
  writeFileSync(file, txt.split(anchor).join(block + replacement));
  return { changed: true };
}
// dsh web 回环免 token：单用户本机 cookie 无效时对 GET / 自动签发 30 天会话 cookie
// （与 token 交换同一持久签名密钥、绑定 authority），有效 cookie 直接放行，无 303 循环；
// 旧进程残留的过期 token URL 也走回环兜底换新 cookie，不再死锁 401；非回环仍走原 token 流程。
function patchLoopbackAuth(file = CONN_FILE) {
  const txt = readFileSafe(file);
  if (!txt) throw new Error('dsh-client-connection 文件不存在，需手动处理: ' + file);
  if (hasPatch(txt, "回环地址兜底")) return { changed: false };
  const helperAnchor = 'function tokenMatches(actual, expected) {\n\tconst actualBytes = Buffer.from(actual, "utf8");\n\tconst expectedBytes = Buffer.from(expected, "utf8");\n\treturn actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes);\n}';
  const inlineMint = '\t\t\t\tconst issuedAt = Date.now();\n\t\t\t\tconst expiresAt = issuedAt + this.maxAgeMilliseconds;\n\t\t\t\tconst value = encodeCookie({\n\t\t\t\t\tversion: COOKIE_PAYLOAD_VERSION,\n\t\t\t\t\tauthority,\n\t\t\t\t\tissuedAt,\n\t\t\t\t\texpiresAt\n\t\t\t\t}, this.secret);\n\t\t\t\tres.writeHead(303, {\n\t\t\t\t\t"cache-control": "no-store",\n\t\t\t\t\t"location": "/",\n\t\t\t\t\t"referrer-policy": "no-referrer",\n\t\t\t\t\t"set-cookie": sessionCookie(cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1e3))\n\t\t\t\t});\n\t\t\t\tres.end();\n\t\t\t\treturn false;\n\t\t\t}';
  const tokensTailAnchor = '\t\t\tthis.writeUnauthorized(req, res);\n\t\t\treturn false;\n\t\t}\n\t\tif (this.isAuthenticated(req)) return true;';
  const noTokenTailAnchor = '\t\tif (this.isAuthenticated(req)) return true;\n\t\tthis.writeUnauthorized(req, res);\n\t\treturn false;\n\t}';
  for (const [name, anchor] of [['helper', helperAnchor], ['inlineMint', inlineMint], ['tokensTail', tokensTailAnchor], ['noTokenTail', noTokenTailAnchor]]) {
    if (!txt.includes(anchor)) throw new Error('client-connection 补丁锚点缺失(' + name + ')，需手动处理: ' + file);
  }
  const helper =
    '\n/** Loopback authorities are trusted on this single-user machine (HarmonyOS patch). */\n' +
    'function isLoopbackAuthority(authority) {\n' +
    '\tif (typeof authority !== "string") return false;\n' +
    '\tlet host = authority;\n' +
    '\tif (host.startsWith("[")) {\n' +
    '\t\tconst end = host.indexOf("]");\n' +
    '\t\tif (end === -1) return false;\n' +
    '\t\thost = host.slice(1, end);\n' +
    '\t} else {\n' +
    '\t\thost = host.split(":")[0];\n' +
    '\t}\n' +
    '\treturn host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("127.");\n' +
    '}';
  const mintCall = '\t\t\t\tthis.mintCookie(req, res, authority);\n\t\t\t\treturn false;\n\t\t\t}';
  const staleFallback =
    '\t\t\t/* HarmonyOS patch: 回环地址兜底——旧进程的过期 token(浏览器里残留的旧 URL)\n' +
    '\t\t\t * 直接换新 cookie，避免「authentication required」死锁；非回环仍 401。 */\n' +
    '\t\t\tif (this.loopbackSession(req)) {\n' +
    '\t\t\t\tthis.mintCookie(req, res, requestAuthority(req.headers));\n' +
    '\t\t\t\treturn false;\n' +
    '\t\t\t}\n';
  const noTokenFallback =
    '\t\t/* HarmonyOS patch: 单用户本机(127.0.0.1/localhost)直接访问 / 无需 token，自动签发\n' +
    '\t\t * 30 天 cookie(与 token 交换同一签名密钥/绑定 authority)，随后刷新即可持续登录。\n' +
    '\t\t * 仅在 cookie 无效时兜底，避免有效会话被 303 循环；非回环地址仍走原 token 流程。 */\n' +
    '\t\tif (this.loopbackSession(req)) {\n' +
    '\t\t\tthis.mintCookie(req, res, requestAuthority(req.headers));\n' +
    '\t\t\treturn false;\n' +
    '\t\t}\n';
  const methods =
    '\t/** Mint the authority-bound 30-day session cookie and redirect to clean `/` (HarmonyOS patch). */\n' +
    '\tmintCookie(req, res, authority) {\n' +
    '\t\tconst issuedAt = Date.now();\n' +
    '\t\tconst expiresAt = issuedAt + this.maxAgeMilliseconds;\n' +
    '\t\tconst value = encodeCookie({\n' +
    '\t\t\tversion: COOKIE_PAYLOAD_VERSION,\n' +
    '\t\t\tauthority,\n' +
    '\t\t\tissuedAt,\n' +
    '\t\t\texpiresAt\n' +
    '\t\t}, this.secret);\n' +
    '\t\tres.writeHead(303, {\n' +
    '\t\t\t"cache-control": "no-store",\n' +
    '\t\t\t"location": "/",\n' +
    '\t\t\t"referrer-policy": "no-referrer",\n' +
    '\t\t\t"set-cookie": sessionCookie(cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1e3))\n' +
    '\t\t});\n' +
    '\t\tres.end();\n' +
    '\t}\n' +
    '\t/** True for a GET index request from a trusted loopback authority (HarmonyOS patch). */\n' +
    '\tloopbackSession(req) {\n' +
    '\t\tconst authority = requestAuthority(req.headers);\n' +
    '\t\tif (req.method !== "GET" || authority === void 0 || !isLoopbackAuthority(authority)) return false;\n' +
    '\t\tconst url = new URL(req.url ?? "/", "http://dsh.invalid");\n' +
    '\t\treturn url.pathname === "/";\n' +
    '\t}';
  let patched = txt
    .split(helperAnchor).join(helperAnchor + helper)
    .split(inlineMint).join(mintCall)
    .split(tokensTailAnchor).join(staleFallback + tokensTailAnchor)
    .split(noTokenTailAnchor).join('\t\tif (this.isAuthenticated(req)) return true;\n' + noTokenFallback + '\t\tthis.writeUnauthorized(req, res);\n\t\treturn false;\n\t}\n' + methods);
  writeFileSync(file, patched);
  return { changed: true };
}
// 汇总: 对某目标的全部实例应用同一补丁(幂等)。任一实例变化即报 changed。
function patchEvery(files, fn, label) {
  if (!files.length) throw new Error(label + ' 未找到任何实例，需手动处理');
  const per = files.map((f) => ({ file: f, ...(fn(f)) }));
  const changed = per.some((r) => r.changed);
  const detail = per.map((r) => ({ file: r.file.replace(DSH_DIR + '/', ''), changed: r.changed, ...(r.skipped ? { skipped: r.skipped } : {}) }));
  return { changed, instances: detail };
}
// dsh-sandbox-policy: 鸿蒙无 OS 沙箱后端(seccomp/landlock 之类), 强制默认 danger-full-access。
// 注意: 此函数原先**从未被 patchAll 调用**(与 v0.7.3 修的 patchFsSearch 同类漏调用),
// 靠启动器注入 DSH_OHOS_FORCE_DANGER=1 + settings.yaml seed 兜住才没暴露; v0.8.0 接回并纳入校验。
function patchSandboxPolicy() {
  const file = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-sandbox-policy', 'lib', 'index.js');
  const txt = readFileSafe(file);
  if (!txt) return { changed: false, skipped: 'sandbox-policy 缺失' };
  if (txt.includes('DSH_OHOS_FORCE_DANGER')) return { changed: false };
  const anchor = 'this.defaultMode = config.mode;';
  if (!txt.includes(anchor)) throw new Error('sandbox-policy 补丁锚点缺失(需人工确认 defaultMode 赋值)，文件: ' + file);
  writeFileSync(file, txt.replace(anchor,
    'this.defaultMode = process.env.DSH_OHOS_FORCE_DANGER === \'1\' ? \'danger-full-access\' : config.mode; // dsh-harmonyos: OHOS 无 OS 沙箱后端'));
  return { changed: true };
}
function patchFsSearch(file) {
  // fs-search(glob/grep) 写死用 @vscode/ripgrep 包内二进制(鸿蒙平台门控装不上且 glibc 系)。
  // 允许 DSH_RG_PATH 指向 musl rg(预编译/本机), 否则保持原逻辑。
  const txt = readFileSafe(file);
  if (!txt) return { changed: false, skipped: 'fs-search 缺失' };
  if (txt.includes('DSH_RG_PATH')) return { changed: false };
  const anchor = 'return (await import("@vscode/ripgrep")).rgPath;';
  if (!txt.includes(anchor)) throw new Error('fs-search 补丁锚点缺失');
  writeFileSync(file, txt.replace(anchor,
    'return process.env.DSH_RG_PATH || (await import("@vscode/ripgrep")).rgPath; // dsh-harmonyos'));
  return { changed: true };
}
// 0.1.5-rc.1 起 dsh-session-persistence-jsonl / dsh-sandbox-local 的会话锁不再走纯 JS,
// 改为 '@deepseek-ai/node-addon-system/flock' 加载**原生** system.node; 而该原生包是
// optionalDependencies 按平台分发(@deepseek-ai/node-addon-system-linux-arm64 等), 鸿蒙上
// npm 永远装不上 → boot 期直接 "Cannot find module @deepseek-ai/node-addon-system-linux-arm64/package.json"
// (0.1.3 无此包, 纯 JS 写声明, 故 rc.1 才暴露)。鸿蒙单进程场景下 POSIX flock 本就只是
// 跨进程保护, 与 compat/fs-ext-shim.mjs 的既有取舍一致: stub 成「立即成功」, 单进程写语义
// 由 in-process claim 保证。只换掉原生绑定加载, tryLockExclusive 的成功分支原样复用。
function patchNodeAddonFlock() {
  const file = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'node-addon-system', 'lib', 'flock.js');
  const txt = readFileSafe(file);
  if (!txt) return { changed: false, skipped: 'node-addon-system/flock 缺失(该版本不需要)' };
  if (txt.includes('HarmonyOS no-op memory flock')) return { changed: false };
  const anchor = `    const { platform, arch } = process;
    if (platform !== 'linux' && platform !== 'darwin') {
        throw Object.assign(new Error(\`flock is not supported on \${platform}-\${arch}\`), {
            code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM',
            syscall: 'flock',
        });
    }
    let filename = 'system.node';
    if (platform === 'linux') {
        // Node's report types omit the libc field supplied by Linux reports.
        const report = process.report.getReport();
        filename = join(report.header.glibcVersionRuntime ? 'glibc' : 'musl', filename);
    }
    const require = createRequire(import.meta.url);
    const manifest = require.resolve(\`@deepseek-ai/node-addon-system-\${platform}-\${arch}/package.json\`);
    binding = require(join(dirname(manifest), 'bin', filename));
    return binding;`;
  if (!txt.includes(anchor)) throw new Error('node-addon-system flock 补丁锚点缺失(需人工确认 loadBinding)，文件: ' + file);
  const stub = `    // HarmonyOS no-op memory flock: OHOS 无 system.node 原生绑定(平台门控装不上)。
    // errno 0 = 获取成功, tryLockExclusive 随即 resolve(与 fs-ext shim 同语义: 单进程无需跨进程锁)。
    binding = { tryLock: (_fd, callback) => callback(0) };
    return binding;`;
  writeFileSync(file, txt.replace(anchor, stub));
  return { changed: true };
}
// 华为官方浏览器(ArkWeb)把未知 scheme 当不透明 URL: new URL("dsh-resource://file/...") 不抛错,
// 但 hostname 恒为空(pathname 含双斜杠) —— 标准浏览器/其它系统为分层解析, hostname="file"。
// protocolOf 按 hostname 取资源协议, 空 host → undefined → 所有文件资源状态 "none" →
// 侧边栏文件预览报「文件资源服务不可用」(文件树/模型列表不走资源协议, 故不受影响, 曾误导排查)。
// 回退: URL 解析拿不到 host 时, 按 dsh-resource://<protocol>/ 手工拆解(对正常浏览器无影响)。
function patchClientResources(file) {
  const txt = readFileSafe(file);
  if (!txt) return { changed: false, skipped: 'dsh-client-resources 缺失' };
  if (hasPatch(txt, 'protocolOf 手动回退')) return { changed: false };
  const fnAnchor = 'function protocolOf(address) {';
  const lineAnchor = 'return parsed.hostname === "" ? void 0 : parsed.hostname.toLowerCase();';
  if (!txt.includes(fnAnchor) || !txt.includes(lineAnchor)) {
    throw new Error('dsh-client-resources protocolOf 补丁锚点缺失(需人工确认)，文件: ' + file);
  }
  const helper =
    '\t\t/* HarmonyOS patch: protocolOf 手动回退 —— ArkWeb(华为官方浏览器)对未知 scheme 按不透明 URL\n' +
    '\t\t   解析, hostname 恒为空导致资源协议识别失败; 拿不到 host 时按 dsh-resource://<protocol>/ 手工拆解。 */\n' +
    '\t\tfunction manualProtocolOf(address) {\n' +
    '\t\t\tconst match = /^dsh-resource:\\/\\/([^/?#]+)/i.exec(String(address));\n' +
    '\t\t\treturn match ? match[1].toLowerCase() : void 0;\n' +
    '\t\t}\n';
  const patched = txt
    .replace(fnAnchor, helper + fnAnchor)
    .replace(lineAnchor, 'return parsed.hostname === "" ? manualProtocolOf(address) : parsed.hostname.toLowerCase();');
  writeFileSync(file, patched);
  return { changed: true };
}
// dsh-client-resources 的可补丁文件是 lib/client.js(浏览器加载的服务端 bundle), 不是 lib/index.js。
function clientResourcesFiles() {
  const found = locatePkgFiles('dsh-client-resources', 'lib/client.js');
  return found.length ? found : [join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-client-resources', 'lib', 'client.js')];
}
function patchAll() {
  const r1 = patchEvery(allInstances('dsh-credentials-local'), patchCredentials, 'credentials-local');
  const r2 = patchEvery(allInstances('dsh-session-persistence-jsonl'), patchSession, 'session-persistence-jsonl');
  const r3 = patchEvery(allInstances('dsh-permission-presets'), patchPermission, 'permission-presets');
  const r4 = patchEvery(allInstances('dsh-attachment-local'), patchAttachment, 'attachment-local');
  const r4b = patchEvery(allInstances('dsh-attachment-local'), patchAttachmentAlias, 'attachment-local(alias)');
  const r5 = existsSync(VISUAL_FILE) ? patchVision() : { changed: false, skipped: 'visual-plugin 未安装' };
  // node26(原生 zstd/现代 loader)不再需要 cordis-loader v0 补丁: 跳过, 防官方升级锚点失配卡住。
  const r6 = RUNTIME_HAS_NATIVE_ZSTD ? { changed: false, skipped: 'node26 原生 loader, 无需 v0 补丁' } : patchEvery(allInstances('cordis-plugin-loader'), patchCordisLoader, 'cordis-plugin-loader');
  const r7 = patchEvery(allInstances('dsh-settings'), patchSettingsCompat, 'dsh-settings');
  const r8 = patchEvery(allInstances('dsh-client-connection'), patchLoopbackAuth, 'dsh-client-connection');
  const r9 = patchEvery(allInstances('dsh-fs-local'), patchFsLocal, 'dsh-fs-local');
  const r10 = patchEvery(allInstances('dsh-tool-fs-search'), patchFsSearch, 'dsh-tool-fs-search');
  const r11 = patchSandboxPolicy();
  const r12 = patchNodeAddonFlock();
  const r13 = patchEvery(clientResourcesFiles(), patchClientResources, 'dsh-client-resources(client)');
  // MARK 校验也必须覆盖全部实例(漏打任意一份, boot 就会加载到未补丁副本)。
  const required = [
    ...allInstances('dsh-credentials-local'), ...allInstances('dsh-session-persistence-jsonl'),
    ...allInstances('dsh-permission-presets'), ...allInstances('dsh-attachment-local'),
    ...allInstances('dsh-settings'), ...allInstances('dsh-client-connection'),
  ];
  if (!RUNTIME_HAS_NATIVE_ZSTD) required.push(...allInstances('cordis-plugin-loader'));
  if (existsSync(VISUAL_FILE)) required.push(VISUAL_FILE);
  for (const f of required) {
    if (!readFileSafe(f).includes(MARK)) throw new Error('补丁校验失败(标记缺失): ' + f);
  }
  for (const f of allInstances('dsh-fs-local')) {
    if (!readFileSafe(f).includes('HarmonyOS /storage mounts reject hard links')) {
      throw new Error('补丁校验失败(标记缺失): ' + f);
    }
  }
  for (const f of allInstances('dsh-tool-fs-search')) {
    if (!readFileSafe(f).includes('DSH_RG_PATH')) {
      throw new Error('补丁校验失败(标记缺失): ' + f);
    }
  }
  {
    const f = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-sandbox-policy', 'lib', 'index.js');
    if (existsSync(f) && !readFileSafe(f).includes('DSH_OHOS_FORCE_DANGER')) {
      throw new Error('补丁校验失败(标记缺失): ' + f);
    }
  }
  {
    const f = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'node-addon-system', 'lib', 'flock.js');
    if (existsSync(f) && !readFileSafe(f).includes('HarmonyOS no-op memory flock')) {
      throw new Error('补丁校验失败(标记缺失): ' + f);
    }
  }
  // session 的标记校验只覆盖第 1 条(materializePosix)——第 2 条(publishCurrentExclusive)必须单独校验：
  // 否则一旦该点漏打(例如手工局部回退、或将来又加新 link 路径)，boot 照常过、直到打开历史会话才炸。
  for (const f of allInstances('dsh-session-persistence-jsonl')) {
    if (!readFileSafe(f).includes('HarmonyOS patch: publishCurrentExclusive')) {
      throw new Error('补丁校验失败(迁移路径 publishCurrentExclusive 未打): ' + f);
    }
  }
  // 同理校验 attachment 的 publishImmutableAlias 那条(文件附件别名发布)。
  for (const f of allInstances('dsh-attachment-local')) {
    if (!readFileSafe(f).includes('HarmonyOS patch: publishImmutableAlias')) {
      throw new Error('补丁校验失败(别名路径 publishImmutableAlias 未打): ' + f);
    }
  }
  // dsh-client-resources 的 protocolOf 手动回退(ArkWeb 不透明 scheme 导致资源协议识别失败)。
  for (const f of clientResourcesFiles()) {
    if (!readFileSafe(f).includes('HarmonyOS patch: protocolOf 手动回退')) {
      throw new Error('补丁校验失败(protocolOf 手动回退未打): ' + f);
    }
  }
  return { credential: r1, session: r2, permission: r3, attachment: r4, attachmentAlias: r4b, vision: r5, cordisLoader: r6, settingsCompat: r7, loopbackAuth: r8, fsLocal: r9, fsSearch: r10, sandboxPolicy: r11, nodeAddonFlock: r12, clientResources: r13 };
}

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'check') { console.log(JSON.stringify(check(), null, 2)); return; }
  if (cmd === 'patch') { console.log(JSON.stringify(patchAll(), null, 2)); return; }
  die('dsh-harmonyos 仅支持 patch/check; 升级官方 dsh 见 README: 仓库内改 pin → npm install → npm run patch && npm run prune');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error("✗ patch error:", e); process.exit(1); });
