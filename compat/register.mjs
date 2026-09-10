// ESM hooks 引导: 由 dsh-ohos 以 --import 在应用代码之前加载, 把 compat-loader 的 resolve 钩子
// 挂进模块解析链路。
//
// 优先 module.registerHooks()(node >= 22.15): 同步钩子、主线程进程内执行, 是 node26 的推荐形态。
// 本机 node26 上旧的 module.register() 已弃用(DEP0205: "module.register() is deprecated.
// Use module.registerHooks() instead."), 每次启动都会打这句警告, 故只在旧 node(node 20.6~22.14,
// 含鸿蒙自带 node 22.7.0)上回退到 register()。两条路径共用 compat-loader 的同一个同步 resolve 钩子。
import { register, registerHooks } from 'node:module';

// 平台归一: 鸿蒙 node 的 process.platform='openharmony' 会让按平台分发的原生包
// (sharp 的 @img/sharp-*-arm64、node-pty prebuilds 等)匹配不到。归一成 'linux':
// sharp 走 @img/sharp-linuxmusl-arm64(真 musl 预编译), 其余 linux 系分支也正确。
// 必须在 compat-loader 之前生效 —— 用动态 import 保证顺序(静态 import 会被提升到本行之前)。
try { Object.defineProperty(process, 'platform', { value: 'linux', configurable: true }); } catch { /* ignore */ }

const { resolve: resolveHook } = await import('./compat-loader.mjs');
if (typeof registerHooks === 'function') registerHooks({ resolve: resolveHook });
else register('./compat-loader.mjs', import.meta.url);
