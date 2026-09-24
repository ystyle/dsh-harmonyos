# dsh-harmonyos

DeepSeek Harness (dsh) 的 HarmonyOS 适配发行版 —— 让官方 dsh 在鸿蒙 PC(musl arm64 / 受限存储)上完整跑起来。

## 更新日志

最新：**v0.13.2**（2026-09-25）— koffi 预编译改用证书签名 + 启动器如实报告签名

近期版本：

- **v0.13.1** — 修复 koffi 版本漂移导致的源码编译回退（精确钉版 `koffi 3.3.1`）
- **v0.13.0** — 适配官方 dsh **0.1.7-rc.2**（内置预设机制重写为 bundle 声明）
- **v0.12.1** — 修复内置预设引用已移除的包导致「新建会话按钮点了没反应」（[issue #5](https://github.com/ystyle/dsh-harmonyos/issues/5)）

完整历史（含每个版本的根因与验证方式）见 **[CHANGELOG.md](CHANGELOG.md)** —— 升级前建议读一下当前版本条目。

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
- 官方 dsh 及其依赖由 npm 拉取(`@deepseek-ai/dsh` 0.1.7-rc.2)。

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
| `DSH_OHOS_PRESET` | 内置预设开关/换包: `off` 关闭; 其它合法包名则注册该 bundle | `@dsh-harmonyos/preset-harmonyos-chat` |

### 内置系统提示词（harmonyos-chat 预设）

`presets/harmonyos-chat/` 是一个**内置 agent 预设 bundle**（基于官方 `standard`
完整编码 Agent），其 persona 已把鸿蒙运行环境说明写进系统提示词：
鸿蒙内核、`target=linux-aarch64-ohos`、与 Linux ABI 兼容但**不是** Linux、
`/tmp` 只读、临时文件写 `$TMPDIR`（默认 `~/.cache`）。

0.1.7-rc.2 起官方把预设机制从「`$DSH_HOME/.agent-presets/<id>/` 目录」改成
「bundle 里的 `@deepseek-ai/dsh-agent-preset` 声明行」（旧目录已无人读取），因此：

- 预设随独立包 `@dsh-harmonyos/preset-harmonyos-chat` 分发（`dsh-harmonyos` 的依赖），
  启动器把它的包名写进 profile 的 `dsh.profile.bundles` —— 之后新建的会话
  「一开始就内置」这套系统提示词；全新 home 下 profile 清单会被预建，首个会话即生效。
- 想改提示词：编辑 `~/.dsh/profiles/<profile>/cordis.patch.yml`，按 id 覆盖
  `preset-harmonyos-chat` 的 `config.plugins`（用户 patch 层在 bundle 之后应用，
  末次写入生效）；或直接改仓库 `presets/harmonyos-chat/cordis.patch.yml` 后重装本发行版。
- 不改默认：在 profile 的 `cordis.patch.yml` 里覆盖 `agent-preset-registry` 的
  `config.default`（Web 界面的预设选择也会写进该层，优先级更高）。
- 关闭/换包：`DSH_OHOS_PRESET=off` 或 `DSH_OHOS_PRESET=<其它bundle包名>`。
- 发布前自查：`npm run preset-check`（核对每个插件可解析 + 与官方 standard 预设比对漂移）。

受限沙箱(如 pi agent 环境)内 prebuilt 二进制可能被 exec 白名单拦截, 用本机受信 rg:
```sh
DSH_RG_PATH="$HOME/.local/bin/rg" dsh-ohos
```
真机(非受限沙箱)默认即可, 无需设置。

> 首次启动自愈: patch(源码补丁) + prune + prebuilt 铺位(koffi/node-pty, AGC 签名) +
> sharp wasm32 后端确认 + seed 权限默认(danger-full-access) + 注册内置预设 bundle(harmonyos-chat)。
> 升级/重装后 marker 版本不一致会自动重跑。

## 适配机制

| 层 | 机制 | 说明 |
|---|---|---|
| 平台归一 | `compat/register.mjs` | `process.platform` 归一为 `linux`(module.register 引导)。鸿蒙 node 上报 `openharmony`, 会让按平台分发的包匹配失败 |
| 启动器 | `bin/dsh-ohos.js` | 读 `NODE_OHOS`(强制); 首启自愈; 注入 `DSH_OHOS_FORCE_DANGER=1`(默认非沙箱); seed `permission.defaultPreset=danger-full-access`; **注册内置预设 bundle `@dsh-harmonyos/preset-harmonyos-chat`(写入 profile 的 `dsh.profile.bundles`, 系统提示词开箱自带, 见下)**; 固定 `--expose-internals --experimental-sqlite --import compat/register.mjs`; 受限沙箱自动 `--jitless` |
| compat loader | `compat/compat-loader.mjs` | 模块重定向: `node:zlib`/`node:module`(原生优先, 旧 node 回退 shim)、`fs-ext`(flock stub)、`koffi`(默认走真构建; `DSH_OHOS_KOFFI=shim` 退回 stub)、sharp 不拦截(wasm32 后端) |
| 源码补丁 | `lib/patch.mjs` + `package.json` **dependencies 别名** | 8 个平台语义改动已 **fork 固化**(`@deepseek-ai/<pkg>` 直接依赖 `npm:@dsh-harmonyos/<pkg>@…`, 任意安装场景生效, 见 `fork-patches/`); patch.mjs 对 fork 条目因标记幂等自动 no-op, 残余(permission/loopbackAuth/fs-search/requireBuiltin 等)仍兜底。**npm 11 嵌套布局多实例全部覆盖** |
| 升级预检 | `lib/anchors.mjs` + `scripts/preset-check.mjs` | **`npm run preflight [树路径]`**: fork 文件(自带标记)逐文件跳过, 残余(未 fork)锚点必须全部命中。**`npm run preset-check`**: 内置预设逐行 `require.resolve` + 与官方 `standard` 预设比对漂移。两者都在 CI 门禁里 |
| profile 层 | `overlays/harmonyos.patch.yml` + `lib/prune.mjs` | overlay **启用** subprocess/sandbox/bash-sandbox/open-in-app/**tool-fs-search**(走 DSH_RG_PATH); prune 仅移除 pwsh-sandbox |
| 旧预设迁移 | `scripts/migrate-presets.mjs` | 0.1.7 起 `.agent-presets/` 目录不再被读取 → 把旧目录转成 `@deepseek-ai/dsh-agent-preset` 声明行写进 profile patch(自动把失效的 persona `text` 改名为 `prefix`); 默认预演, `--write` 才落盘 |
| 预编译 | `prebuilt/` | koffi-3.3.0 / node-pty-1.2.0-beta.15(linux-arm64-musl, N-API) + **rg**(ripgrep, musl) — 均 **hmsign-release AGC 签名** → 免编译免工具链; 版本不匹配自动回退源码编译 |

补丁锚点为精确代码片段, 失配即**报错拒绝**(绝不静默打错)。

### 升级官方 dsh 的安全流程

fork 之后, 上游源码改动以 `fork-patches/*.patch` 版本化在本仓库(diff 即真值), 上游升级时 diff 重新应用到新 tarball; 失配会**报错拒绝**(绝不静默打错)。按下面的顺序做, 生产树全程不受影响:

```sh
# 1. 升 pin + 更新 FORKS 清单版本(scripts/forks-list.mjs), 两处必须同步
#    @deepseek-ai/dsh 与 @deepseek-ai/dsh-host-directory-picker-auto
vi package.json scripts/forks-list.mjs && npm install --package-lock-only --ignore-scripts

# 2. 重建全部 fork(diff apply 到新 tarball, 标记校验; 失配会列出需人工修的 patch)
npm run sync-forks

# 3. 发布 fork 包(需 @dsh-harmonyos scope 的 NODE_AUTH_TOKEN)
npm run sync-forks -- --publish

# 4. 本地全量验证(fork 树安装零补丁 + 残余锚点预检 + 端到端冒烟)
npm ci --ignore-scripts && npm run preflight && npm test

# 5. 发本体(先 npm run cutover -- --apply 把 dependencies 别名同步到新 fork 版本,
#    再 bump package.json 版本 → 打 v* tag 自动发布)
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
- 预编译覆盖 koffi 3.3.0 / node-pty 1.2.0-beta.15 / rg(musl ripgrep); 升级需配套新 prebuilt 或走源码编译回退
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
