# dsh-harmonyos

DeepSeek Harness (dsh) 的 HarmonyOS 适配发行版 —— 让官方 dsh 在鸿蒙 PC(musl arm64 / 受限存储)上完整跑起来。

## 更新日志

- **v0.8.2** (2026-09-10) — 修复华为官方浏览器(ArkWeb)文件预览「文件资源服务不可用」
  - ArkWeb 把未知 scheme `dsh-resource://` 当不透明 URL 解析, `new URL()` 的 `hostname` 恒为空 → 客户端资源协议识别失败 → 文件预览 `meta.status="none"`(文件树/模型列表不走资源协议, 故正常, 极易误判)
  - 新增补丁 `patchClientResources`: `protocolOf` 解析不到 host 时按 `dsh-resource://<protocol>/` 手工拆解回退; 标准浏览器/系统为分层解析, 不受影响
- **v0.8.1** (2026-09-10) — 修复历史会话迁移 EPERM
  - rc.1 新增第 2 条 link 发布路径 `publishCurrentExclusive`(v2→v3 会话迁移), 原 `patchSession` 以「文件含 MARK 整体跳过」做幂等 → 第 2 条永远漏补, 表现为新建会话正常、打开老会话即 EPERM
  - 改为逐点幂等 + rename 回退; 同类补齐 `dsh-attachment-local` 的 `publishImmutableAlias`(`copyFile` + `COPYFILE_EXCL`)
- **v0.8.0** (2026-09-10) — 适配官方 dsh 0.1.5-rc.1
  - 官方 `@deepseek-ai/dsh` **0.1.5-rc.1**; 运行时 **node26**(原生 zstd, 建议经 [Harmonybrew](https://atomgit.com/Harmonybrew) 安装); koffi/node-pty 鸿蒙 PC 预编译(AGC 签名), sharp 走 **wasm32**(无原生 dlopen 依赖)
  - 升级面: 补丁引擎锚点零改动(新增 `npm run preflight` 预检兜住后续升级); 原生依赖版本未变 → **prebuilt 无需重做**
  - 修复: ① `patchSandboxPolicy` 定义了但从未被 `patchAll` 调用(与 v0.7.3 的 `patchFsSearch` 同类漏调用); ② rc.1 的 permission 服务在构造期反推默认 preset, 不显式指定即抛错 → 启动器注入 `DSH_PERMISSION_MODE=danger-full-access`
  - 附带: 启动器清理无主写锁 + 信号转发(防孤儿 dsh 进程); compat 改 `registerHooks()` 消除 node26 弃用警告
  - 验证: 真实 Agent 全链路(deepseek-v4-flash → 思考 → bash/文件工具 → 交付, headless + web 均实测)

## 环境要求

- **node >= 22.16**(带原生 zstd), 强烈推荐 **node26**。
- **鸿蒙 PC 建议直接用 [Harmonybrew](https://atomgit.com/Harmonybrew) 安装 node**(默认 `node` 即 **26**):
  ```sh
  brew install node        # 默认即 node 26
  node --version           # v26.x
  ```
  然后配置环境变量(未配置 `dsh-ohos` 会直接报错):
  ```sh
  # ~/.zshrc
  export NODE_OHOS="$(brew --prefix)/opt/node/bin/node"
  ```
- 官方 dsh 及其依赖由 npm 拉取(`@deepseek-ai/dsh` 0.1.5-rc.1)。

## 安装与启动

```sh
# 安装(带 --ignore-scripts: 原生包 install 脚本在鸿蒙必失败, 由首启自愈接管)
npm i -g dsh-harmonyos --ignore-scripts

# 启动 web UI
dsh-ohos                    # → http://127.0.0.1:3080 (token 见启动日志; 回环直开免 token)

# 或跑一次 headless 任务(真实 agent 全循环)
dsh-ohos -- --profile headless --patch "$(npm root -g)/dsh-harmonyos/overlays/harmonyos.patch.yml" "你的任务描述"

# 透传/换端口
dsh-ohos -- --port 3081
```

升级:
```sh
npm i -g dsh-harmonyos@latest --ignore-scripts
```

### 可选环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `NODE_OHOS` | 指定 node(≥22.16, 推荐 26) | 必填, 未设报错 |
| `DSH_OHOS_FORCE_DANGER=1` | 强制非沙箱执行(OHOS 无 OS 沙箱后端) | 默认注入 |
| `DSH_PERMISSION_MODE=danger-full-access` | 让 permission 服务推出的默认 preset 落到 `danger-full-access`(0.1.5-rc.1 必需, 否则 boot 期直接抛错) | 默认注入 |
| `DSH_RG_PATH` | 指定 ripgrep 路径(glob/grep 用) | prebuilt/rg(AGC 签名) |

受限沙箱(如 pi agent 环境)内 prebuilt 二进制可能被 exec 白名单拦截, 用本机受信 rg:
```sh
DSH_RG_PATH="$HOME/.local/bin/rg" dsh-ohos
```
真机(非受限沙箱)默认即可, 无需设置。

> 首次启动自愈: patch(源码补丁) + prune + prebuilt 铺位(koffi/node-pty, AGC 签名) +
> sharp wasm32 后端确认 + seed 权限默认(danger-full-access)。升级/重装后 marker 版本不一致会自动重跑。

## 适配机制

| 层 | 机制 | 说明 |
|---|---|---|
| 平台归一 | `compat/register.mjs` | `process.platform` 归一为 `linux`(module.register 引导)。鸿蒙 node 上报 `openharmony`, 会让按平台分发的包匹配失败 |
| 启动器 | `bin/dsh-ohos.js` | 读 `NODE_OHOS`(强制); 首启自愈; 注入 `DSH_OHOS_FORCE_DANGER=1`(默认非沙箱); seed `permission.defaultPreset=danger-full-access`; 固定 `--expose-internals --experimental-sqlite --import compat/register.mjs`; 受限沙箱自动 `--jitless` |
| compat loader | `compat/compat-loader.mjs` | 模块重定向: `node:zlib`/`node:module`(原生优先, 旧 node 回退 shim)、`fs-ext`(flock stub)、`koffi`(默认走真构建; `DSH_OHOS_KOFFI=shim` 退回 stub)、sharp 不拦截(wasm32 后端) |
| 源码补丁 | `lib/patch.mjs` | 幂等打官方包: 硬链接 EPERM→rename、chmod 600 属主检查跳过、回环免 token、settings 旧 API 垫片、**sandbox-policy 默认 mode=danger**、**fs-search 支持 DSH_RG_PATH**。**npm 11 嵌套布局多实例全部补丁并逐一校验** |
| 升级预检 | `lib/anchors.mjs` | **`npm run preflight [树路径]`**: 在未打补丁的树上核对全部补丁锚点是否仍命中。官方升级后先在隔离 staging 树跑它, 就能在动生产树之前知道要不要改锚点 |
| profile 层 | `overlays/harmonyos.patch.yml` + `lib/prune.mjs` | overlay **启用** subprocess/sandbox/bash-sandbox/open-in-app/**tool-fs-search**(走 DSH_RG_PATH); prune 仅移除 pwsh-sandbox |
| 预编译 | `prebuilt/` | koffi-3.2.1 / node-pty-1.2.0-beta.15(linux-arm64-musl, N-API) + **rg**(ripgrep, musl) — 均 **hmsign-release AGC 签名** → 免编译免工具链; 版本不匹配自动回退源码编译 |

补丁锚点为精确代码片段, 失配即**报错拒绝**(绝不静默打错)。

### 升级官方 dsh 的安全流程

运行时补丁打在 `node_modules` 里的官方包上, `npm install` 会冲掉它们 —— 所以**永远不要在生产安装目录里原地 `npm i`**。
按下面的顺序做, 生产树全程不受影响:

```sh
# 1. 改 pin(两处必须同步升, 否则会把上一版 dsh-base 再拉一份)
#    @deepseek-ai/dsh 与 @deepseek-ai/dsh-host-directory-picker-auto
vi package.json && npm install --package-lock-only --ignore-scripts

# 2. 在与生产同构的隔离目录里装新树(不碰生产)
git clone <本仓库> /tmp/new && cd /tmp/new
npm install --ignore-scripts --no-audit --no-fund

# 3. 锚点预检 —— 这一步告诉你要不要改补丁引擎
npm run preflight

# 4. 打补丁 + 冒烟
npm run patch && npm run prune && npm test
```

四步全绿后再替换生产目录(同一父目录内两次 rename 原子切换, 便于回滚):

```sh
D=$HOME/.harmonybrew/lib/node_modules
mv $D/dsh-harmonyos $D/dsh-harmonyos.bak && mv /tmp/new $D/dsh-harmonyos
```

> 已在跑的 dsh 进程不会受影响(模块早已载入内存); 新起的进程才用新版本。
> 回滚就是把两条 rename 反过来。确认稳定后再删 `.bak`。

> ⚠️ **别用 `kill -9` 杀 dsh 进程。** 官方 `dsh-atomic-write` 的写锁是
> `$DSH_HOME/profiles/node_modules.lock` 这个文件(`open(wx)` 建, `finally` 里删),
> 被 SIGKILL 时不会执行清理, 留下**无主锁文件**; 之后**每个** dsh 启动都会卡在
> `atomic-write: timed out waiting for the writer lock`(0.1.3 / 0.1.5 都一样, 与版本无关)。
> 中招了就手动删掉那个 lock 文件。

## 功能状态(实测)

| 能力 | 状态 |
|---|---|
| Web UI / 会话 | ✅ |
| **Agent 全循环**(模型→bash→文件→交付) | ✅ 实测(headless + web), 默认 deepseek-official / deepseek-v4-flash |
| 终端 / 子进程(node-pty + koffi, 预编译 AGC) | ✅ |
| 图片附件 / 读图(sharp **wasm32**) | ✅ 实测 decode/resize/**encode**(webp/jpeg 全阶梯) + `read_image` 端到端 |
| bash / shell 工具 | ✅ 非沙箱直跑(danger-full-access) |
| OS 级沙箱隔离 | ❌ OHOS 无后端(非 linux 内核能力) → 默认 danger 直跑, 等同本机其它 agent |
| 全局搜索 glob/grep(ripgrep) | ✅ v0.7 恢复: fs-search 走 `DSH_RG_PATH` → 预编译 musl rg(AGC 签名, prebuilt/rg), danger 下实测正常 |

## 配 API key

`~/.dsh/.credentials.yaml`:
```yaml
DEEPSEEK_API_KEY: sk-...
```

默认模型在 `~/.dsh/settings.yaml`:
```yaml
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash   # deepseek-chat 已弃用
```

## 开发模式(git clone + npm link)

```sh
git clone https://github.com/ystyle/dsh-harmonyos && cd dsh-harmonyos
npm install && npm link && dsh-ohos
```
> ⚠️ 开发模式下**不要**再用 `npm i -g dsh-harmonyos` 覆盖软链; 仓库内升级走
> `npm install && npm run patch && npm run prune` 后重启。

## 已知取舍

- 无 OS 沙箱: 默认 danger-full-access 非沙箱执行(个人设备语义, 同 Claude Code/pi 本机行为)
- 预编译 rg 的 exec 在受限 pi 沙箱内可能被白名单拒(本沙箱只认受信 inode), 真机无此限制; 可用 `DSH_RG_PATH` 指向本机受信 rg
- 预编译覆盖 koffi 3.2.1 / node-pty 1.2.0-beta.15 / rg(musl ripgrep); 升级需配套新 prebuilt 或走源码编译回退
- 图片编解码走 sharp **wasm32**(比原生慢, 但功能完整: decode + resize + webp/jpeg 编码全阶梯实测通过)。
  曾尝试原生 `@img/sharp-linuxmusl-arm64`: AGC 签名后能过沙箱 dlopen 校验, 但该 musl 预编译绑定需要
  `libstdc++.so.6`, 而鸿蒙 node 是 musl 构建、系统内无此库 → 原生后端不可用, 维持 wasm32。
  边界: **1×1 像素**图片编码会报 `vipspng: libpng read error`(libpng 无法处理单像素输出), 实际图片尺寸无此问题
- prebuilt 为 AGC 签名全局可信; 源码编译回退产物为机器本地自签
- **会话锁是纯 JS no-op stub**(0.1.5-rc.1 起官方改用 `@deepseek-ai/node-addon-system` 原生 `system.node`,
  按平台分发因此鸿蒙装不上; 补丁把原生绑定加载换成「立即成功」, 语义同既有 `fs-ext` flock stub)
  → 单进程内由 in-process 写声明保证, 不做跨进程互斥
- **官方 `dsh-atomic-write` 的写锁是 `.lock` 文件**(不是内核锁), 进程被 `kill -9` 会留下无主锁并使
  之后所有启动超时; 启动器每次启动已自动清理无主锁, 但尽量用 `SIGTERM` 结束 dsh 进程
- 冷启动(含 profile module-fallback 自愈)在鸿蒙存储上约 45-70s, `npm test` 的等待窗口已相应放宽
- 受限沙箱(非 brew node 域)下 dlopen 仍可能被拒, 以实测为准

## License 与致谢

MIT(见 LICENSE)。本发行版**参考并改编**了多个开源项目：
- **dsh-harmonyos-pc**(MIT): 补丁逻辑、overlay 机制、八套鸿蒙预设(预设见 `~/.dsh/.agent-presets/` 或 presets/)
- **dsh-harmony**(MIT): 早期兼容层方法论
- **dsh-TUI / dsh-desktop**: 发行形态参考(未取代码)
- 预编译二进制(koffi/node-pty/ripgrep)与依赖(sharp-wasm32/fzstd 等)按各自许可再分发

完整归属与许可说明见 **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**。
