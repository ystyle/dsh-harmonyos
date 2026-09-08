# dsh-harmonyos

DeepSeek Harness (dsh) 的 HarmonyOS 适配发行版 —— 让官方 dsh 在鸿蒙(musl/受限存储)上跑起来。

> 本分支基于 v0.1.0 跟进官方 `@deepseek-ai/dsh` **0.1.3-alpha.2**, 运行时从 node22 切换到 **node26**(原生 zstd),
> 并将「node22 补齐」类兼容层改造为「原生优先/按需 stub」。增量说明与插件化建议见分支 commit 信息。License: MIT。

## 环境要求

- **node >= 22.16**(带原生 zstd), 强烈推荐 **node26**。通过环境变量指定:
  ```sh
  # ~/.zshrc
  export NODE_OHOS="$HOME/.harmonybrew/opt/node/bin/node"
  ```
  未配置时 `dsh-ohos` / `patch.mjs` 会**直接报错**(不静默回落)。
- 官方 dsh 及其依赖由 npm 拉取(`@deepseek-ai/dsh` 0.1.3-alpha.2)。

## 安装 (HarmonyOS / 受限沙箱)

```sh
git clone <本仓库> dsh-harmonyos && cd dsh-harmonyos
npm install                # postinstall 自动: patch(补丁) + prune(剪枝)
npm link                   # 暴露 dsh-ohos 命令(开发模式; 见下方「升级」警告)
dsh-ohos                   # web UI → http://127.0.0.1:3080 (token 见启动日志)
```

`npm install` 不用 `--ignore-scripts`: 本包的 postinstall 只跑 patch/prune(纯 JS),
原生编译问题已由 prune 解决。

## 启动

```sh
dsh-ohos                              # 默认 3080 (作者约定端口)
dsh-ohos -- --port 3081               # 透传官方参数, 换端口(调试推荐, 与旧实例并行)
dsh-ohos -- --profile headless "任务"  # 透传任意官方 dsh 参数
```

## 适配机制(4 层)

| 层 | 机制 | 说明 |
|---|---|---|
| 启动器 | `bin/dsh-ohos.js` | 读 `NODE_OHOS`; 首启自愈(patch+prune); 固定 `--expose-internals --experimental-sqlite --experimental-loader compat`; v23+ 受限沙箱自动 `--jitless` |
| compat loader | `compat/compat-loader.mjs` | 模块重定向: `node:zlib`/`node:module`(原生优先, 旧 node 回退 shim)、`fs-ext`(flock stub, 官方 browser-worker 部署同款方案)、`sharp`(抛 `SHARP_UNAVAILABLE`, 图片附件走 INVALID_IMAGE 降级) |
| 源码补丁 | `lib/patch.mjs` | 幂等打官方包源码: 硬链接 EPERM→rename(session/attachment/fs-local)、chmod 600 属主检查跳过(credentials)、sandboxMode 改读 fs 沙箱(permission-presets)、回环免 token(loopback)、settings 旧 API 垫片。**npm 11 嵌套布局下同一包可能有多份实例, 全部实例都会补丁并逐一校验** |
| profile 层 | `overlays/harmonyos.patch.yml` + `lib/prune.mjs` | overlay 禁用原生行(subprocess/sandbox/bash-sandbox/open-in-app)、目录选择器换纯 JS browse 变体; prune 递归移除 koffi/node-pty 及 5 个宿主包 |

补丁锚点为精确代码片段, 失配即**报错拒绝**(绝不静默打错); 门控: node26(原生 loader)下
自动跳过 cordis-loader v0 补丁。

## 升级官方 dsh

```sh
# 1. 改 package.json 里 @deepseek-ai/dsh 的版本
# 2. 重装依赖 + 重打补丁
npm install && npm run patch && npm run prune
# 3. 重启 dsh-ohos
```

> ⚠️ **不要**用 `npm i -g dsh-harmonyos@latest` 升级: 开发模式下全局安装位是软链(npm link),
> npm 重装会把软链替换成普通目录, 拆掉开发环境。升级一律走上面的仓库内流程。

## 常用维护命令

```sh
npm run patch    # 重打全部补丁(幂等)
npm run check    # 检查已装版本 vs 最新
npm run prune    # 重新剪枝(幂等)
npm test         # 端到端冒烟: 起服务 → token 认证 303+cookie → / 200
```

> 启动时的自愈不是只看标记文件存在: marker 记录补丁生效时的 dsh 版本,
> 版本不一致(升级冲掉补丁 / postinstall 被 npm 策略跳过)会自动重打 patch/prune。

## 配 API key

`~/.dsh/.credentials.yaml`:
```yaml
DEEPSEEK_API_KEY: sk-...
```

## 已知取舍

- 无终端/子进程/沙箱(bash 设备上没有, 原生模块加载不了); 系统 App 沙箱兜底
- 图片处理(sharp)不可用: 图片附件报「不支持」, 普通附件/会话不受影响
- session.lock 的 flock 为 stub(单进程下 in-process 写声明已排除并发写者)
- `open-in-app` 已禁用(依赖被禁的 subprocess 服务)

## License

MIT(见 LICENSE)。基于原 dsh-harmonyos(MIT) 改造。
