#!/usr/bin/env node
// dsh-harmonyos 端到端冒烟测试 (npm test)
// 流程: 起 dsh-ohos(随机空闲端口) → 等「dsh web: <token-url>」→ GET token URL 期待 303+set-cookie
//       → 带 cookie GET / 期待 200 → 杀进程。全链路通过 exit 0, 否则 exit 1(打印日志尾部)。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRAP = join(ROOT, 'bin', 'dsh-ohos.js');

if (!process.env.NODE_OHOS) {
  console.error('smoke: 未配置 NODE_OHOS(见 README 环境要求)');
  process.exit(1);
}

// 取一个空闲端口
const port = await new Promise((resolve, reject) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  srv.on('error', reject);
});

const child = spawn(process.env.NODE_OHOS, [WRAP, '--', '--profile', 'web', '--patch', join(ROOT, 'overlays', 'harmonyos.patch.yml'), '--no-open', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '', tokenUrl = '';
const grab = (d) => {
  log += d;
  const m = /dsh web: (http\S+)/.exec(d.toString());
  if (m && !tokenUrl) tokenUrl = m[1];
};
child.stdout.on('data', grab);
child.stderr.on('data', grab);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false, detail = '';
try {
  for (let i = 0; i < 45 && !ok; i++) {
    await sleep(2000);
    if (child.exitCode !== null) { detail = `dsh 进程提前退出(exit=${child.exitCode})`; break; }
    if (!tokenUrl) continue;
    // 1) token URL → 期待 303 + set-cookie
    const res = await fetch(tokenUrl, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((s) => s.split(';')[0]).join('; ');
    if (res.status !== 303 && res.status !== 302) { detail = `token URL 期待 303, 得到 ${res.status}`; continue; }
    if (!cookie) { detail = 'token URL 未签发 cookie'; continue; }
    // 2) 带 cookie 访问 / → 期待 200
    const res2 = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', headers: { cookie }, signal: AbortSignal.timeout(3000) });
    if (res2.status === 200) { ok = true; detail = `token 303+cookie → / 200 (端口 ${port})`; }
    else detail = `带 cookie GET / 期待 200, 得到 ${res2.status}`;
  }
  if (!ok && !detail) detail = '超时: 45 秒内未完成认证链路';
} finally {
  child.kill('SIGTERM');
  await sleep(1500);
  if (child.exitCode === null) child.kill('SIGKILL');
}

console.log(ok ? `smoke: PASS — ${detail}` : `smoke: FAIL — ${detail}`);
if (!ok) console.log('---- 日志尾部 ----\n' + log.split('\n').slice(-25).join('\n'));
process.exit(ok ? 0 : 1);
