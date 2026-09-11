#!/usr/bin/env node
// dsh-ohos: DeepSeek Harness for HarmonyOS 启动器
//   - 定位本包 node_modules 里的官方 dsh
//   - 自动挑可用 node: 优先「带原生 zstd 的」(node>=22.16, 免 wasm 兼容层)
//   - 固定必要参数: --expose-internals --experimental-sqlite --experimental-loader compat
//   - 挂载 dsh-harmonyos overlay(原生行替换/禁用)
// 用法:
//   dsh-ohos                  # 启动 web(127.0.0.1:3080, 作者默认)
//   dsh-ohos -- <官方dsh参数>   # 透传(如 --profile headless "任务"、--port 3081)
//   NODE_OHOS=/path/node dsh-ohos   # 指定 node
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, copyFileSync, mkdirSync, rmSync, appendFileSync, chmodSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDshDir } from '../lib/locate.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// dsh 定位: 支持嵌套(依赖装进包内 node_modules)与平铺(标准 npm -g 平铺到 node_modules 容器)布局,
// 见 lib/locate.mjs。返回「dsh 依赖容器所在目录」(其下 node_modules 含 @deepseek-ai/*)。
const DSH_DIR = locateDshDir(ROOT);
const NM = join(DSH_DIR, 'node_modules');
const MARKER = join(NM, '.dsh-harmonyos-ready');
const MARK = 'dsh-harmonyos-ready';

// 环境校验前置: 先确认 NODE_OHOS 可用, 再谈自愈/启动。
function pickNode() {
  const nodeBin = process.env.NODE_OHOS;
  if (!nodeBin) {
    console.error('dsh-ohos: 未配置 NODE_OHOS 环境变量。');
    console.error('  dsh 需要 node >= 22.16(带原生 zstd), 推荐 node26。请在 ~/.zshrc 配置:');
    console.error("    export NODE_OHOS=\"$HOME/.harmonybrew/opt/node/bin/node\"");
    console.error('  然后重开 shell 或 source ~/.zshrc 再运行 dsh-ohos。');
    process.exit(1);
  }
  if (!existsSync(nodeBin)) {
    console.error(`dsh-ohos: NODE_OHOS 指向的 node 不存在: ${nodeBin}`);
    console.error('  请检查路径, 或改配: export NODE_OHOS="$HOME/.harmonybrew/opt/node/bin/node"');
    process.exit(1);
  }
  return nodeBin;
}
const nodeBin = pickNode();

// marker 记录「补丁生效时的 dsh 版本」。版本不一致(升级后补丁被 npm install 冲掉,
// 或 postinstall 被 npm allowScripts 策略跳过)→ 自动重打; 只看存在性的旧方案会在
// 升级后带着未打补丁的包静默启动, 是正确性缺陷。
function installedDshVersion() {
  try { return JSON.parse(readFileSync(join(NM, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
}
function markerVersion() {
  try { return (readFileSync(MARKER, 'utf8').split(/\r?\n/)[0].trim().split(/\s+/)[1]) || ''; }
  catch { return ''; }
}
const dshVersion = installedDshVersion();
if (!existsSync(join(NM, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
  console.error('dsh-ohos: 未找到 ' + join(NM, '@deepseek-ai', 'dsh', 'lib', 'bin.js') + ' — 请先在本仓库 npm install(拉取 @deepseek-ai/dsh)');
  process.exit(1);
}
if (!dshVersion || markerVersion() !== dshVersion) {
  try {
    console.error(`dsh-ohos: 补丁状态与 dsh@${dshVersion || '?'} 不一致(marker=${markerVersion() || '无'}), 重打 patch/prune…`);
    execFileSync(nodeBin, [join(ROOT, 'lib', 'patch.mjs'), 'patch'], { stdio: 'inherit' });
    execFileSync(nodeBin, [join(ROOT, 'lib', 'prune.mjs')], { stdio: 'inherit' });
    writeFileSync(MARKER, MARK + ' ' + dshVersion + '\n');
  } catch (e) {
    console.error('dsh-ohos: 自愈(patch/prune)失败:', e.message);
    process.exit(1);
  }
}
const DSLIB = join(NM, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const LOADER = join(ROOT, 'compat', 'register.mjs');   // module.register() 引导(--import), 替代弃用的 --experimental-loader
const OVERLAY = join(ROOT, 'overlays', 'harmonyos.patch.yml');

if (!existsSync(DSLIB)) {
  console.error('dsh-ohos: 未找到 ' + DSLIB + ' — 请先在本仓库 npm install(拉取 @deepseek-ai/dsh)');
  process.exit(1);
}

// node-pty 就地编译(ensure-pty): subprocess 行已启用, 需要真实 pty.node。
// npm --ignore-scripts 跳过构建, 这里用 NODE_OHOS + 同前缀 npm 的 node-gyp 补编译。
// 找 binary-sign-tool(补 .codesign 段用): hnp / home / PATH
function signTool() {
  const cands = [
    process.env.BINARY_SIGN_TOOL,
    '/data/service/hnp/bin/binary-sign-tool',
    join(process.env.HOME || '', '.local', 'bin', 'binary-sign-tool'),
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) || null;
}
function codeSign(file) {
  const tool = signTool();
  if (!tool) { console.error('dsh-ohos: 无 binary-sign-tool, 无法补 .codesign → ' + file); return false; }
  const tmp = file + '.signed';
  const r = spawnSync(tool, ['sign', '-inFile', file, '-outFile', tmp, '-selfSign', '1'], { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(tmp)) return false;
  renameSync(tmp, file);
  return true;
}

// koffi 就地构建: 补丁 cnoke(cmake 认 Linux/aarch64) + cnoke 构建 + .codesign 签名。
function ensureKoffi(nodeBin) {
  const dirs = [];
  try { for (const e of readdirSync(NM)) if (e === 'koffi') dirs.push(join(NM, e)); } catch { /* ignore */ }
  if (dirs.length === 0) { console.error('dsh-ohos: 树里没有 koffi — subprocess 需要真 koffi'); return; }
  for (const dir of dirs) {
    const cnoke = join(dir, 'cnoke.cjs');
    const loaderNode = join(dir, 'build', 'koffi', 'openharmony_arm64', 'koffi.node');
    const outNode = join(dir, 'build', 'koffi', 'openharmony_arm64', 'v26.8.1_native', 'Release', 'Output', 'koffi.node');
    // 预编译优先(AGC 签名): prebuilt/koffi-<版本>-linux-arm64-musl.node → 铺全部 triplet
    const ver = (() => { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || ''; } catch { return ''; } })();
    const pre = join(ROOT, 'prebuilt', 'koffi-' + ver + '-linux-arm64-musl.node');
    if (existsSync(pre)) {
      let used = false;
      for (const triplet of ['openharmony_arm64', 'linux_arm64', 'musl_arm64']) {
        const target = join(dir, 'build', 'koffi', triplet, 'koffi.node');
        if (existsSync(target)) continue;
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(pre, target);
        used = true;
      }
      if (used) console.error('dsh-ohos: 使用预编译 koffi(' + ver + ', AGC 签名)');
      continue;
    }
    if (!existsSync(outNode)) {
      if (existsSync(cnoke)) {
        let c = readFileSync(cnoke, 'utf8');
        const need = '-DCMAKE_SYSTEM_NAME=Linux';
        if (!c.includes(need)) {
          c = c.replace('args.push("--no-warn-unused-cli");',
            'args.push("-DCMAKE_SYSTEM_NAME=Linux");\n    args.push("-DCMAKE_SYSTEM_PROCESSOR=aarch64");\n    args.push("--no-warn-unused-cli");');
          writeFileSync(cnoke, c);
        }
      }
      console.error('dsh-ohos: 编译 koffi(源码, 需 clang/cmake)…');
      const r = spawnSync(nodeBin, ['cnoke.cjs', '-P', '.', '-D', 'src/koffi', '--prebuild', '--release'], { cwd: dir, stdio: 'inherit' });
      if (r.status !== 0 || !existsSync(outNode)) { console.error('dsh-ohos: koffi 编译失败(exit=' + r.status + ')'); process.exit(1); }
    }
    // 签名 + 铺路径: koffi 的 JS loader 按运行时 platform 找 build/koffi/<triplet>/koffi.node
    // (linux → linux_arm64 优先、musl_arm64 兜底); 构建期 cnoke 用的是 openharmony_arm64。
    // 把签名产物铺到所有 triplet 路径(幂等, 已存在且含 codesign 则跳过)。
    const signedOk = (f) => existsSync(f) && (() => { try { return readFileSync(f, 'utf8').includes('codesign'); } catch { return false; } })();
    if (!signedOk(outNode) && !codeSign(outNode)) { console.error('dsh-ohos: koffi 签名失败 → ' + outNode); process.exit(1); }
    for (const triplet of ['openharmony_arm64', 'linux_arm64', 'musl_arm64']) {
      const target = join(dir, 'build', 'koffi', triplet, 'koffi.node');
      if (signedOk(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(outNode, target);
      if (!codeSign(target)) { console.error('dsh-ohos: koffi 签名失败 → ' + target); process.exit(1); }
    }
  }
}

// sharp 原生后端: npm 平台门控(os:linux,libc:musl)在鸿蒙(openharmony)永不安装,
// 从 prebuilt/sharp-linuxmusl-arm64-<ver>/ 物化到 node_modules/@img/sharp-linuxmusl-arm64。
function ensureSharp() {
  // sharp 后端 = @img/sharp-wasm32(纯 wasm, sharp 可选依赖自动安装, 无平台门控)。
  // @img/sharp-linuxmusl-arm64 无法在鸿蒙 npm 安装(os:linux/libc:musl 门控)且 .node 在此沙箱
  // dlopen 不稳 → 存在则移除, 强制 sharp 走 wasm 后端(实测 decode/resize OK)。
  const img = join(NM, '@img');
  const bad = join(img, 'sharp-linuxmusl-arm64');
  if (existsSync(bad)) { rmSync(bad, { recursive: true, force: true }); console.error('dsh-ohos: 移除 sharp linuxmusl(改走 wasm32)'); }
}


function ensurePty(nodeBin) {
  const dirs = [];
  try { for (const e of readdirSync(NM)) if (e === 'node-pty') dirs.push(join(NM, e)); } catch { /* ignore */ }
  if (dirs.length === 0) {
    // npm11 可能嵌套在 @deepseek-ai/dsh/node_modules 等; 浅层补扫
    try { for (const a of readdirSync(NM)) {
      const sub = join(NM, a, 'node_modules');
      try { for (const e of readdirSync(sub)) if (e === 'node-pty') dirs.push(join(sub, e)); } catch { /* ignore */ }
    } } catch { /* ignore */ }
  }
  if (dirs.length === 0) {
    console.error('dsh-ohos: 树里没有 node-pty(依赖缺失?) — subprocess 行将无法加载');
    return;
  }
  for (const dir of dirs) {
    const ptyNode = join(dir, 'build', 'Release', 'pty.node');
    if (existsSync(ptyNode)) continue;
    // 预编译优先(AGC 签名, 免工具链): prebuilt/node-pty-<版本>-linux-arm64-musl.node
    const ver = (() => { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || ''; } catch { return ''; } })();
    const pre = join(ROOT, 'prebuilt', 'node-pty-' + ver + '-linux-arm64-musl.node');
    if (existsSync(pre)) {
      mkdirSync(dirname(ptyNode), { recursive: true });
      copyFileSync(pre, ptyNode);
      console.error('dsh-ohos: 使用预编译 node-pty(' + ver + ', AGC 签名)');
      continue;
    }
    console.error('dsh-ohos: 无匹配预编译 node-pty(' + ver + '), 走源码编译');
    // 定位 node-gyp: 优先用与 NODE_OHOS 同前缀的 npm 查全局根(npm i -g 装的布局),
    // 再退回常见 brew/deveco 前缀布局。node-gyp 12 无 PGO 问题, 直接 rebuild。
    const npmBin = join(dirname(nodeBin), 'npm');
    let npmRoot = '';
    try { npmRoot = execFileSync(npmBin, ['root', '-g'], { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
    const gypCandidates = [
      ...(npmRoot ? [join(npmRoot, 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')] : []),
      join(dirname(dirname(nodeBin)), 'lib', 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
    ];
    const gyp = gypCandidates.find((p) => existsSync(p));
    if (!gyp) { console.error('dsh-ohos: 找不到 node-gyp(' + gypCandidates.join(', ') + ') — 无法编译 node-pty'); process.exit(1); }
    console.error('dsh-ohos: 编译 node-pty → ' + ptyNode);
    const r = spawnSync(nodeBin, [gyp, 'rebuild'], {
      cwd: dir, stdio: 'inherit',
      env: { ...process.env, CC: process.env.CC || 'clang', CXX: process.env.CXX || 'clang++' },
    });
    if (r.status !== 0 || !existsSync(ptyNode)) {
      console.error('dsh-ohos: node-pty 编译失败(exit=' + r.status + ') — subprocess 行启用但无法加载, 启动中止');
      process.exit(1);
    }
  }
}
function probe(nodeBin) {
  return new Promise((resolve) => {
    const c = spawn(nodeBin, ['-e', '0'], { stdio: 'ignore' });
    const t = setTimeout(() => { c.kill(); resolve({ jitless: false }); }, 4000);
    c.on('exit', (code, sig) => {
      clearTimeout(t);
      // 信号/非零退出(如 V8 fatal) → 需要 --jitless
      resolve({ jitless: sig !== null || code !== 0 });
    });
    c.on('error', () => { clearTimeout(t); resolve({ jitless: false }); });
  });
}

const probeResult = await probe(nodeBin);
const nodeArgs = [];
if (probeResult.jitless) {
  console.error('dsh-ohos: 检测到当前 node 在受限沙箱无法分配可执行内存, 使用 --jitless(仅 CLI/服务可用)');
  nodeArgs.push('--jitless');
}
ensureSharp();
ensurePty(nodeBin);
ensureKoffi(nodeBin);
nodeArgs.push('--expose-internals', '--experimental-sqlite', '--import', LOADER);

const dash = process.argv.indexOf('--');
const passthrough = dash === -1 ? [] : process.argv.slice(dash + 1);
const args = dash === -1
  ? ['--profile', 'web', '--patch', OVERLAY, '--no-open']
  : passthrough;

console.error(`dsh-ohos: node=${nodeBin}${probeResult.jitless ? ' --jitless' : ''}`);
console.error(`dsh-ohos: dsh=${DSLIB}\ndsh-ohos: overlay=${OVERLAY}`);

// 陈旧写锁清理。官方 dsh-atomic-write 的跨进程写锁 = <target>.lock 文件(open(wx) 建,
// finally 里 rm 删); 进程被 SIGKILL / 崩溃时 finally 不执行, 留下**无主锁文件**。
// 官方 isLockContention 只认 EEXIST, 没有 owner 存活检测也没有超时回收, 于是之后每个
// dsh 启动都会卡满 20s 再抛 "atomic-write: timed out waiting for the writer lock" ——
// 0.1.3 / 0.1.5 同样中招(与版本无关, 实测)。鸿蒙上无法可靠回收锁, 启动前主动清一次:
// 锁文件里的 PID 已不存在(或内容不成形)即判定无主。不会误删活锁(活着的持有者 PID 命中即跳过)。
function clearStaleWriteLocks() {
  const home = process.env.HOME || '';
  const dshHome = process.env.DSH_HOME || join(home, '.dsh');
  const scanned = [];
  const consider = (p) => {
    try {
      if (!existsSync(p)) return;
      const pid = Number.parseInt((readFileSync(p, 'utf8').split('\n')[0] || '').trim(), 10);
      if (Number.isInteger(pid) && pid > 1) {
        let alive = false;
        try { process.kill(pid, 0); alive = true; } catch (e) { alive = e && e.code === 'EPERM'; }
        if (alive) return; // 持有者还在 → 是活锁, 不动
      }
      rmSync(p, { force: true });
      scanned.push(p);
    } catch { /* ignore */ }
  };
  // 已知会被 atomic-write 加锁的目标(按需增补即可)
  consider(join(dshHome, '.credentials.yaml.lock'));
  consider(join(dshHome, 'settings.yaml.lock'));
  consider(join(dshHome, 'profiles', 'node_modules.lock'));
  try {
    const sdir = join(dshHome, 'sessions');
    for (const e of readdirSync(sdir)) consider(join(sdir, e, 'session.lock'));
  } catch { /* ignore */ }
  for (const p of scanned) console.error('dsh-ohos: 清理陈旧写锁 ' + p);
}
clearStaleWriteLocks();

// 首启 seed: ~/.dsh/settings.yaml 无 permission 段时补 defaultPreset=danger-full-access
// (鸿蒙无 OS 沙箱后端; danger = 非沙箱直跑, 等同本机其它 agent)
function seedPermissionDefault() {
  const home = process.env.HOME || '';
  const sp = join(home, '.dsh', 'settings.yaml');
  try {
    if (!existsSync(sp)) return;
    const txt = readFileSync(sp, 'utf8');
    if (/^permission:/m.test(txt)) return;
    appendFileSync(sp, '\npermission:\n  defaultPreset: danger-full-access\n');
    console.error('dsh-ohos: 已 seed permission.defaultPreset=danger-full-access(鸿蒙无沙箱后端)');
  } catch { /* ignore */ }
}
seedPermissionDefault();

// 内置预设 seed: 把仓库 presets/<id>/ 预置到 $DSH_HOME/.agent-presets/<id>/
// 「系统提示词在一开始就内置」的实现 —— 会话的 system prompt 由它挂载的 agent
// preset 组合出来, 让新会话默认挂上内置预设即等于提示词开箱自带。
//   - 只在「缺失」或「模板比已落地文件新」时同步, 绝不覆盖用户后续编辑
//     (用户自己改过 → 落地文件 mtime 更新 → 跳过)
//   - settings.yaml 尚未出现 agent-presets 命名空间时补 default 指到该预设;
//     用户一旦自己设置过(默认预设或改回别的), 尊重其选择, 不再写入
//   - DSH_OHOS_PRESET=off 关闭; =其它合法 id 时改用该 id 落地(便于自己改名)
function seedBuiltinPreset() {
  const presetId = 'harmonyos-chat';
  const want = (process.env.DSH_OHOS_PRESET || '').trim();
  if (want === 'off' || want === '0' || want === 'false') return;
  // 幂等 id 兜底: 非法字符/撞 shipped 预设名 → 退回模板默认 id
  const shipped = ['standard', 'ptc', 'minimal', 'cordis'];
  const id = /^[a-z0-9][a-z0-9-]*$/.test(want) && !shipped.includes(want) ? want : presetId;
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh');
  const src = join(ROOT, 'presets', presetId);
  if (!existsSync(join(src, 'agent.cordis.yml'))) return; // 仓库缺模板(如旧安装) → 静默跳过
  const dst = join(home, '.agent-presets', id);
  try {
    const newerThan = (a, b) => { try { return statSync(a).mtimeMs > statSync(b).mtimeMs; } catch { return true; } };
    let changed = false;
    for (const f of ['preset.yml', 'agent.cordis.yml']) {
      const s = join(src, f);
      const d = join(dst, f);
      if (!existsSync(d)) { mkdirSync(dst, { recursive: true }); copyFileSync(s, d); changed = true; }
      else if (newerThan(s, d)) { copyFileSync(s, d); changed = true; } // 模板更新 → 刷新
    }
    if (changed) console.error(`dsh-ohos: 已 seed 内置预设 ${id}(${dst})`);
    const sp = join(home, 'settings.yaml');
    if (existsSync(sp)) {
      if (!/^agent-presets:/m.test(readFileSync(sp, 'utf8'))) {
        appendFileSync(sp, `\nagent-presets:\n  default: ${id}\n`);
        console.error(`dsh-ohos: 已 seed 默认预设 agent-presets.default=${id}`);
      }
    } else {
      // 全新 home: settings.yaml 尚未生成(dsh 首次写设置时才创建), 直接建一个最小文件,
      // 否则「默认预设」要等第二次启动才生效, 与「开箱即带系统提示词」的承诺不符。
      writeFileSync(sp, `agent-presets:\n  default: ${id}\n`);
      console.error(`dsh-ohos: 已创建 settings.yaml 并 seed 默认预设 agent-presets.default=${id}`);
    }
  } catch { /* 只读/无写权限时静默跳过, 不阻塞启动 */ }
}
seedBuiltinPreset();

const childEnv = { ...process.env };
if (childEnv.DSH_OHOS_FORCE_DANGER === undefined) childEnv.DSH_OHOS_FORCE_DANGER = '1';
// 0.1.5-rc.1 起 permission 服务在构造时会用 ctx.approval.config.policy 反推默认 preset
// (0.1.3 只在有 session 时才碰这条路径)。鸿蒙无 OS 沙箱后端, 不显式指定就会推出
// "custom" 并直接 throw: "composed sandbox and approval defaults match no preset"。
// 官方 approval 插件读 DSH_PERMISSION_MODE 决定 policy, 这里与 DSH_OHOS_FORCE_DANGER
// 同源置为 danger-full-access, 让推导落到 danger-full-access preset。
if (childEnv.DSH_PERMISSION_MODE === undefined) childEnv.DSH_PERMISSION_MODE = 'danger-full-access';
if (childEnv.DSH_RG_PATH === undefined) {
  const prg = join(ROOT, 'prebuilt', 'rg');
  if (existsSync(prg)) {
    try { chmodSync(prg, 0o755); } catch { /* 只读文件系统等情况忽略 */ }
    childEnv.DSH_RG_PATH = prg;
  } else {
    console.error('dsh-ohos: 缺少 prebuilt/rg — glob/grep 不可用(见 README 预编译覆盖)');
  }
}
const child = spawn(nodeBin, [...nodeArgs, DSLIB, ...args], { stdio: 'inherit', env: childEnv });
// 信号转发: 包装进程本身不持任何状态, 收到 SIGINT/SIGTERM(如 Ctrl-C、smoke/npm test 收尾)
// 必须原样转给真正的 dsh 子进程。否则包装进程退出后, 子进程被 reparent 到 PID 1 继续占用
// 端口存活(实测 npm test 收尾会留下孤儿 web 进程), 而它还可能持有 profiles/node_modules 写锁。
let forwarded = false;
const forward = (sig) => {
  if (forwarded || child.exitCode !== null) return;
  forwarded = true;
  try { child.kill(sig); } catch { /* ignore */ }
  // 收尾兜底: 5s 内没退出就强杀, 避免留下孤儿
  const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
  if (typeof t.unref === 'function') t.unref();
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => forward(sig));
child.on('error', (e) => { console.error('dsh-ohos: 启动失败:', e.message); process.exit(1); });
child.on('exit', (code, sig) => process.exit(code === null ? (sig ? 1 : 0) : code));
