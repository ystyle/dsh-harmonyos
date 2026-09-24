# AGENTS.md — 给在本仓库工作的 AI Agent

> 本文件是**操作手册**：接手任务前先读完。设计原理见
> [`docs/plans/fork-overrides-consolidation.md`](docs/plans/fork-overrides-consolidation.md)，
> 面向用户的说明见 [`README.md`](README.md)。本文件与代码冲突时以代码为准，并把差异回写到本文件。
>
> 目标读者：在本仓库做升级适配 / 修 bug / 发版的 Agent。所有命令都在**这台鸿蒙 PC** 上跑。

## 0. 这个仓库是什么

`dsh-harmonyos` 是官方 **DeepSeek Harness (dsh)** 的 **HarmonyOS 适配发行版**：
让官方 dsh 在鸿蒙 PC（musl arm64、受限存储、无 root、无沙箱后端）上完整跑起来。

发布物（三者必须版本一致，见 §5）：

| 包 | 内容 |
|---|---|
| `dsh-harmonyos`（npm，本仓库根） | 启动器 `dsh-ohos` + 补丁引擎 + compat 层 + prebuilt + 内置预设 bundle |
| `@dsh-harmonyos/*`（fork 包） | 上游包的鸿蒙改写版，按 npm 别名接入（见 §3） |
| `@dsh-harmonyos/preset-harmonyos-chat` | 内置系统提示词预设（bundle 声明，见 §4） |

## 1. 平台硬约束（每次动代码前先过一遍）

- **鸿蒙不是 Linux**：`process.platform` 上报 `openharmony`，会让按平台分发的包全部匹配失败。
  `compat/register.mjs` 用 `module.register()` 把它归一成 `linux`；启动器固定注入 `--import` 该文件。
- **`/tmp` 只读**：临时文件写 `$TMPDIR`（本机 `~/.cache`）或工作区。写 `/tmp` 会直接失败。
- **`/storage` 挂载不支持硬链接**：`link()` 报 `EPERM`（即使目标不存在）。本仓库**大量补丁**围绕这点
  （session 发布、附件发布、fs-local createIfAbsent 都改成 `rename`）。别写出依赖 `link()` 的新代码。
- **无 OS 沙箱后端**：默认走 `danger-full-access`（启动器注入 `DSH_OHOS_FORCE_DANGER=1` +
  `DSH_PERMISSION_MODE` + `settings.yaml` 兜底）。这是**有意取舍**，不是 bug。
- **原生模块没有现成预编译**：koffi / node-pty 必须我们自己提供产物；sharp 走 `@img/sharp-wasm32`。
- **原生 `.node` 需要 `.codesign` 段才能 dlopen**。仓库 `prebuilt/` 里的产物用**证书签名**
  （`hmsign-release`，见 §6.3）；源码编译兜底产物用 `binary-sign-tool -selfSign 1`（自签）。
  **报告签名状态前必须实测**（§6.4），不要假设。
- **无 root、无 clang/cmake 保证**：发行版承诺「首启零编译」，所以**凡是能预编译的都要预编译进
  `prebuilt/`**，源码编译只作兜底并要走 `--ignore-scripts` 安装路径。

## 2. 目录结构（改哪里的活）

| 路径 | 职责 |
|---|---|
| `bin/dsh-ohos.js` | **唯一用户入口**。解析 `NODE_OHOS`、首启自愈（patch/prune/prebuilt 铺位/预设注册）、注入 env、转发信号给 dsh 子进程 |
| `lib/patch.mjs` | 安装时补丁引擎（锚点匹配 + 幂等标记 + 多实例覆盖）。**残余**补丁住这里 |
| `lib/anchors.mjs` | 升级预检：对**未 fork** 的文件核对锚点，失配即拦下（`npm run preflight`） |
| `lib/prune.mjs` | 裁掉本平台无意义的包（如 `dsh-pwsh-sandbox`） |
| `lib/locate.mjs` | 定位 dsh 树（平铺 / 嵌套布局共用） |
| `compat/` | 模块重定向：`register.mjs`（平台归一）、`compat-loader.mjs`（zlib/module/fs-ext/koffi/sharp 分流）与各 shim |
| `fork-patches/*.patch` | **fork 的真值**：上游 tarball 上的 diff（见 §3） |
| `scripts/forks-list.mjs` | fork 清单唯一事实源（fork 名 / 上游名 / 版本 / 标记） |
| `scripts/sync-forks.mjs` | 重建 / 校验 / 发布 fork（`sync` / `--check` / `--publish`） |
| `presets/harmonyos-chat/` | 内置预设 **bundle**（`package.json` + `cordis.patch.yml`），见 §4 |
| `scripts/preset-check.mjs` | 预设校验：逐行 `require.resolve` + 与官方 standard 比对漂移 |
| `scripts/migrate-presets.mjs` | 旧 `.agent-presets/` 目录 → 新声明行迁移（默认预演，`--write` 落盘） |
| `scripts/smoke.mjs` | 端到端冒烟（起 dsh → token 303 → cookie → `/` 200 → 杀进程） |
| `overlays/harmonyos.patch.yml` | profile 层开关（启用 subprocess/sandbox/fs-search 等） |
| `CHANGELOG.md` | **版本历史**：每个发行版做了什么、为什么（根因/验证/迁移提示）。写版本说明看这里（§8） |
| `prebuilt/` | 原生预编译（koffi / node-pty / rg），命名 `koffi-<版本>-linux-arm64-musl.node` |
| `.github/workflows/` | `ci.yml`（PR 门禁）、`publish.yml`（tag → npm）、`forks.yml` |

## 3. 设计原则（先读再改）

1. **能 fork 就 fork，diff 即真值**。不要新增「安装时打补丁」的机制——安装时补丁脆弱
   （上游改上下文就失配）。fork 走 `dependencies` 里的 npm 别名
   （`"@deepseek-ai/x": "npm:@dsh-harmonyos/x@<上游版本>-harmony.<n>"`），
   **不是** `overrides`（后者只在命令根项目生效，`npm i -g` 时被忽略）。
2. **锚点失配必须报错拒绝，绝不静默打错**。`patch.mjs` 里每条补丁找不到锚点就 `throw`。
   加新补丁时同步往 `lib/anchors.mjs` 加锚点，否则升级预检会漏。
3. **幂等按「该点自己的标记」判定**，不要用「文件里有 `HarmonyOS patch` 就整体跳过」——
   同文件多点补丁时会导致第 2 点永远补不上（历史上炸过）。
4. **多实例覆盖**：npm 嵌套/提升布局下同一个包可能有多份，补丁必须逐实例打
   （`allInstances()`），标记校验也逐实例。
5. **不覆盖用户内容**：预设、`settings.yaml`、profile patch、旧预设目录都只增不改；
   检测到旧机制残留时**提示**而不是擅自迁移。
6. **fork 与残余补丁去重**：同一改动别同时存在于 `fork-patches/` 和 `patch.mjs`
   （v0.13.0 去掉的 `fs-local` / `sandbox-policy` 就是这种冗余）。
   上游若改成**精确钉版**，fork 的 `-harmony.N` 版本会不满足 peer → `npm ci` ERESOLVE。
7. 注释用中文，写**为什么**（约束是什么、踩过什么坑），不要复述代码。

## 4. 内置预设（0.1.7 起的新机制）

上游 0.1.7-rc.2 **删除了 `$DSH_HOME/.agent-presets/` 目录机制**（官方原文：
"Nothing reads that directory any more"）。现在预设 = `@deepseek-ai/dsh-agent-preset`
的**声明行**，由 bundle patch 承载。

- 我们的预设做成独立 bundle 包 `presets/harmonyos-chat/`（`dsh.bundle.patch` → `cordis.patch.yml`），
  同时按 id 覆盖 `agent-preset-registry` 的 `config.default`。
- 启动器 (`ensurePresetBundle`) 把 bundle 包名写进 profile 的 `dsh.profile.bundles`；
  全新 home 会按官方 `initProfile` 模板预建清单（否则默认预设要等第二次启动才生效）。
- **发布前必跑 `npm run preset-check`**：它会逐行 `require.resolve` 预设里的每个插件，
  并与官方 `standard` 预设比对行漂移。**引用了上游已移除的包 = 新会话挂载失败，
  前端只 `console.warn`，表现为「新建会话按钮点了没反应」**（issue #5 的血泪）。
- 改预设内容后：`presets/harmonyos-chat/package.json` 版本要跟主包锁步（§5）。
- 用户的旧 `harmony-*` 预设：用 `scripts/migrate-presets.mjs --write` 迁移
  （会把失效的 persona `text` 键自动改成 `prefix`）。**只能在升级到 0.1.7+ 之后跑**，
  在旧版本上写新声明行会让旧版本启动失败。

## 5. 升级官方 dsh 的标准流程

> 触发场景：官方发新版本（alpha / rc / 正式）。全程**不要动生产树**，先在临时目录验证。

```sh
# 0) 侦察：release notes + 依赖 diff + 官方是否改了机制
#    重点看：新旧 dependencies 差异、原生依赖版本、内置预设/凭据/settings 等机制性改动

# 1) 改 pin（三处必须同步）
#    package.json:            "@deepseek-ai/dsh": "<新版本>"
#    scripts/forks-list.mjs:  version: '<新版本>'（node-addon-system 按其上游实际版本）
#    package.json 的 fork 别名: <新版本>-harmony.1

# 2) 重建 fork 并看 diff 是否还打得进去
npm run sync-forks                 # 失败会打印失配上下文；按新基座重新生成 patch
                                   #   生成法：解开上游 tarball → git init → 手工改写 → git diff

# 3) 残余锚点预检（未 fork 的文件）
npm run preflight                  # 失配就按提示人工适配 patch.mjs/lib/anchors.mjs

# 4) 预设校验
npm run preset-check

# 5) 全新安装验证（必须两种布局都测，见 §7）
```

**版本号纪律**：fork 发布版本 = `<上游版本>-harmony.<n>`；fork 自身修复 `n+1`，
重新跟随上游时回到 `1`。`node-addon-system` 上游长期停在 `0.1.2`，别跟着主版本乱升。

**必看的机制性改动**（踩过的）：
- 依赖由 `^` 改成**精确钉版** → 影响 fork 别名能否满足 peer（§3.6）。
- 启动解析行为变化（如 `resolutionMode` 默认 runtime）→ 会必经
  `node-addon-require-builtin`，鸿蒙无平台二进制 → 需要 JS 回退补丁。
- 预设 / settings / 凭据 / 会话日志格式（Session V4）等**机制重写**，影响面远大于工具增减。
- 上游删除包（如 `dsh-workflow-worker-thread` → `dsh-workflow-ptc`）→ 预设必须同步。

## 6. 原生预编译与签名（本仓库最容易出错的地方）

### 6.1 版本必须钉住

`prebuilt/` 的文件名含**确切版本**，启动器按「树里 koffi/node-pty 的实际版本」找文件。
上游依赖常写成 `^3.1.0` 这种范围 → 重新生成 lockfile 时 npm 可能解析到更新的补丁版
→ 找不到配套预编译 → **回退源码编译**（慢、需工具链）。v0.13.1 就是这么翻的车。

- 对策：在 `package.json` 里**直接依赖并精确钉住**要预编译的包
  （现有：`"koffi": "3.3.1"`、`"@img/sharp-wasm32": "0.35.4"`；`zstd-codec` 用 `^`）。
- 升级这些版本时：钉版本 + 补对应 `prebuilt/` 文件，两件事必须一起做。

### 6.2 产出链（三选一，优先级从高到低）

1. **已有的证书签名产物**：直接用，不要重新编译。
2. **从源码编译**：`cd <koffi pkg> && node cnoke.cjs -P . -D src/koffi --prebuild --release`
   （`cnoke.cjs` 需含 `-DCMAKE_SYSTEM_NAME=Linux` / `-DCMAKE_SYSTEM_PROCESSOR=aarch64`，
   启动器会自动补这两行）。得到**未签名**产物。
3. **拿现成已签名文件**：`llvm-objcopy --remove-section=.codesign <file>` 删掉旧签名段，
   再用 §6.3 重签（注意别改坏 ELF 段结构，优先选 2）。

### 6.3 签名：用 zsh function `hmsign-release`

签名工具是 `binary-sign-tool`（`~/.local/bin`，SDK 软链），口令在环境变量
`HW_YSTYLE_SIGN_PWD` 里，**只在 zsh 环境可用**（定义在 `~/.zshrc` 的 function 里）：

```sh
zsh -ic 'hmsign-release /绝对路径/待签名文件'
```

- 产出**真实证书签名**（Subject 为华为 CBG DevID，与 `prebuilt/node-pty-*.node` 同一条链）。
- **`-outFile` 不可靠**：工具会把结果写到**当前工作目录 + 输入文件名 + `-signed`**
  （不是 `-outFile` 给的路径）。签名完到 `$PWD` 找 `*-signed`。
- 对**已带 `.codesign` 段的文件会失败**（`section already exists`）→ 必须先有未签名产物。
- 启动器的自签兜底 `codeSign()` 用的是 `-selfSign 1`，**那是自签，不是证书签名**，
  只用于源码编译产物；不要把它当成正式签名。

### 6.4 验证签名（**唯一可信的方法**）

```sh
binary-sign-tool display-sign -inFile <file> | head -12
```

- 出现 `certificate #0` + `Issuer: ... Huawei CBG Developer Relations CA G2` = **证书签名** ✅
- `code signature is self-sign` = 自签 ⚠️
- `code signature is not found` = 未签名 ❌

**不要用「文件里含 `codesign` 字符串」判断签名**（本 Agent 犯过这个错并误报为 AGC 签名）。
启动器的 `describeSignature()` 就是这么实测的，报告签名状态时以它/工具的实测输出为准。

## 7. 验证要求（硬性，不可省）

任何「改动了运行路径」的提交，**发布前必须在本机实测**：

1. **全新安装**（两种布局都要，布局差异会暴露多实例/解析问题）：
   ```sh
   npm pack
   # 提升式（作为依赖装进一个空项目）
   npm install --ignore-scripts ./dsh-harmonyos-<v>.tgz
   # 嵌套式（生产同款：npm i -g 的布局）
   npm install -g --prefix "$PWD/prefix" --ignore-scripts ./dsh-harmonyos-<v>.tgz
   ```
   两种都用 `--ignore-scripts`（koffi 的 install script 在鸿蒙必失败）。
2. `node lib/patch.mjs patch` → 全绿；`node lib/prune.mjs`；`node lib/anchors.mjs` → 全命中。
3. `npm run preset-check`。
4. `npm test`（smoke：token 303 + cookie → `/` 200）。用**全新 `DSH_HOME`** 与**真实 home 副本**
   各跑一次；真实 home 副本用来验证迁移逻辑（profile bundles、旧预设、设置）。
5. **客户端功能必须真实浏览器验证**（curl 只证明服务端）：
   远程 Chrome 开 CDP → 打开页面 → 看 `pending:false`、聊天框在、预设正确、
   动作能完成。会话级验证可读 `$DSH_HOME/sessions/.../session.v4.jsonl.zstd` 的创建头
   （含 `agentPreset` / `version`）。
6. 报告里给出**实测命令与输出**，不要写「应该没问题」。

## 8. 发布流程

> **写版本说明**：新版本条目写进 [`CHANGELOG.md`](CHANGELOG.md)（含根因与验证方式），
> README 只保留「最新版本 + 近期三条 + 指向 CHANGELOG」的简短段落。别把完整历史堆回 README。

```sh
# 1) 版本锁步：package.json 与 presets/harmonyos-chat/package.json 必须同版本
#    （CI 的 publish 会断言两者一致；bundle 先发，主包依赖它）
# 2) 先发 bundle（若该版本未发布）
cd presets/harmonyos-chat && npm publish --access public --registry=https://registry.npmjs.org --tag next
# 3) 重新生成 lockfile（含新 bundle 版本）
npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org
# 4) 提交 + 打 tag + push（tag 必须等于 package.json 版本）
git tag v<版本> && git push origin main --tags
# 5) CI: ci.yml + publish.yml（自动 preflight + preset-check + 语法检查 + npm publish）
```

注意事项：

- **npm 认证**：fork/bundle 发布会话需要 `NPM_CONFIG_USERCONFIG=~/.cache/npmrc-fork-pub`
  \+ `NODE_AUTH_TOKEN`（见 §9）。CI 用仓库 secret `NPM_TOKEN`。
- **注册表传播延迟**：`npm publish` 成功后 packument 可能仍看不到新版本（几十秒~几分钟），
  会表现为 `ETARGET` / `E404`。用版本端点确认：`curl -o /dev/null -w '%{http_code}' <registry>/<pkg>/<version>`。
- **别把 npm 输出管道给 `head`**：SIGPIPE 会打断上传，留下「previously staged」的版本（遇到过）。
- **发布的包内容**：`.forks-out/`、`node_modules/`、`*.tgz` 已 gitignore；`prebuilt/` 必须随包
  （`npm pack --dry-run` 确认）。
- 已发布的版本**不能覆盖**；发现问题就发下一个补丁版本。

## 9. 本机环境备忘（这台鸿蒙 PC 特有）

| 事项 | 值 / 做法 |
|---|---|
| Node 运行时 | `NODE_OHOS=/storage/Users/currentUser/.harmonybrew/opt/node/bin/node`（v26.8.1，原生 zstd） |
| 安装根 | `~/.harmonybrew/lib/node_modules/dsh-harmonyos`（嵌套布局）；`$DSH_HOME=~/.dsh` |
| bash 路径 | `/data/service/hnp/bin/bash`（**没有 `/bin/bash`**；脚本 shebang 用 `#!/usr/bin/env bash`） |
| `/tmp` | **只读**（写临时文件用 `~/.cache`） |
| `ip` 命令 | 不可用/受限；查 IP 用 `node -e 'os.networkInterfaces()'`。**wlan0 地址会变** |
| 远程 Chrome | `http://192.168.3.6:9223`（用户设备；本机 IP 变了要重建转发器） |
| 转发器 | `~/.cache/fwd<port>.mjs`：绑本机 IP + 来源白名单，**Host 与 Origin/Referer 都要重写成
`127.0.0.1`**（只改 Host 会被官方同源校验判跨源 → API 403）。模板见该文件 |
| git push | 系统 git 配置里指向**已失效的代理** `192.168.3.6:1081`（`~/.ohos_git/.gitconfig`）。
直连可用 → `git -c "http.https://github.com/.proxy=" push ...` |
| 签名 | `zsh -ic 'hmsign-release <file>'`（§6.3）；`binary-sign-tool display-sign`（§6.4） |
| 生产实例 | `dsh web` 在 3080；**它是当前 GUI 的服务进程** —— 不要在自己这一轮里 kill/重启它
（会掐断会话），需要重启时让用户做 |

## 10. 常见故障 → 对策

| 症状 | 根因 | 对策 |
|---|---|---|
| 首启打印「编译 koffi(源码…)」`Failed to load prebuilt binary` | koffi 实际版本没有配套 `prebuilt/` | §6.1：钉住版本 + 补预编译；别只补文件不钉版本 |
| `npm ci` 报 `ERESOLVE` / peer 冲突 | 上游精确钉版 vs fork 的 `-harmony.N` | §3.6：去掉冗余 fork 改走残余补丁（先确认补丁等价） |
| 新建会话「按钮点了没反应」 | 预设引用了上游已移除的包（前端只 warn） | `npm run preset-check` 定位；同步官方 standard 预设 |
| `resume failed: Cannot find module '@deepseek-ai/node-addon-system-<plat>'` | flock 原生绑定：嵌套实例漏补丁 | 补丁逐实例（`allInstances`），校验也逐实例 |
| `atomic-write: timed out waiting for the writer lock` | 进程被 SIGKILL 留下无主 `.lock` | 启动器 `clearStaleWriteLocks()` 已处理；别绕过它 |
| 远程访问 API 403 | 转发器只重写 Host | 重写 `Origin`/`Referer` 为 `127.0.0.1`（§9） |
| 预设从花名册消失 | 0.1.7 起 `.agent-presets/` 目录不再被读取 | `scripts/migrate-presets.mjs --write`（升级后跑） |

## 11. 红线（不要做）

- 不要编辑 deployment 自带的 shipped preset 目录（`agent-presets`，升级会覆盖）。
- 不要在没有 `--ignore-scripts` 的情况下装这个包（koffi install script 必失败）。
- 不要在未在本机实测的情况下发布（§7）。
- 不要手改 `.forks-out/`（每次 `sync-forks` 重建，改了会丢）。
- 不要把「自签」当「证书签名」报告；不要假设签名状态，去实测（§6.4）。
- 不要用 `ps aux` 判断 dsh 是否在跑（本机受限）——用端口探测（`curl 127.0.0.1:<port>`）。
