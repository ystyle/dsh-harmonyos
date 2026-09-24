# dsh-harmonyos

DeepSeek Harness (dsh) 的 HarmonyOS 适配发行版 —— 让官方 dsh 在鸿蒙 PC(musl arm64 / 受限存储)上完整跑起来。

## 更新日志

- **v0.13.1** (2026-09-25) — **修复 koffi 版本漂移导致回退源码编译**
  - 现象：升级到 0.13.0 后首次启动打印「编译 koffi(源码, 需 clang/cmake)… Failed to load prebuilt binary, rebuilding from source」，不再用仓库自带的预编译
  - 根因：上游依赖写的是 `koffi ^3.1.0`（不是精确钉版），0.13.0 重新生成 `package-lock.json` 时 npm 解析到了最新的 **3.3.1**，而仓库只带 `prebuilt/koffi-3.3.0-…node` → 版本对不上 → 按设计回退源码编译（本机有 clang/cmake 所以能过，但慢、且没有 AGC 签名保障）
  - 修复：① 随包新增 **`prebuilt/koffi-3.3.1-linux-arm64-musl.node`**（本机 cnoke 编译 + codesign 签名，与 3.3.0 同一条产出链）；② 在 `dependencies` 里**精确钉住 `"koffi": "3.3.1"`**，与 `@img/sharp-wasm32`/`zstd-codec` 同一手法，杜绝再次静默漂移；③ 启动器在缺少配套预编译时改为明确报出「本机 koffi 版本 + 仓库自带哪些版本 + 版本漂移通常是没钉住 koffi」
  - 验证（全新全局嵌套安装）：启动输出 `使用预编译 koffi(3.3.1, AGC 签名)`、**编译输出 0 行**、三个 triplet 铺位齐全；smoke PASS、preset-check PASS、anchors PASS
  - 提示：若你已在 0.13.0 上被源码编译过，升级 0.13.1 即可；已编译产物留在 `node_modules/koffi/build/` 里不会被自动清理，可忽略（预编译优先）
- **v0.13.0** (2026-09-25) — 适配官方 dsh **0.1.7-rc.2**（跨 4 个 prerelease 的大版本）
  - 官方 `@deepseek-ai/dsh` → **0.1.7-rc.2**；7 个 fork 包升到 `0.1.7-rc.2-harmony.1`（`node-addon-system` 上游仍 0.1.2 不变）；原生依赖 koffi 3.3.0 / node-pty 1.2.0-beta.15 / sharp-wasm / ripgrep 1.18.0 **零变化** → prebuilt 全部复用
  - 补丁面：**8 个 fork patch 有 7 个在 rc.2 基座原样通过**；`dsh-session-persistence-jsonl` 因上游 Session 日志升 V4 改了 import 行导致上下文漂移 → 按新基座重新生成（三处改动逻辑零变化，已实测干净应用）；残余锚点仅 `dsh-client-connection` 一处随上游适配（token 换发 303 的 `location` 由 `"/"` 改为 `"./"`）
  - **C 类补丁按计划删除**：`dsh-settings` 在 0.1.7 是**全新包**（`SettingsProvider` → `SettingsForms`），旧版兼容垫片（`settingsNamespace`/`installSettingsSection`）已无宿主类可委托 → 删除 `patchSettingsCompat` 及其锚点（已核对本机无插件引用旧 API）
  - ⚠️ **内置预设机制被上游重写**：`$DSH_HOME/.agent-presets/<id>/` 目录**已无人读取**（官方原文 "Nothing reads that directory any more"），预设改为 `@deepseek-ai/dsh-agent-preset` **声明行**、由 bundle patch 承载。本发行版相应对策：
    - 新增独立 bundle 包 **`@dsh-harmonyos/preset-harmonyos-chat`**（`dsh.bundle.patch` → `cordis.patch.yml`），随 `dsh-harmonyos` 依赖安装到 dsh 安装目录；同时把 `agent-preset-registry` 的 `default` 覆盖为 `harmonyos-chat`
    - 启动器改为把 bundle 名写进 profile 的 `dsh.profile.bundles`（bundle 解析优先取 dsh 安装目录，故无需装进 profile、也不动用户 patch 层）；全新 home 下按官方 `initProfile` 模板预建 profile 清单，保证**首个会话**就带上内置提示词
    - 新增 **`npm run preset-check`**：发布前逐行核对预设里每个插件都能从 dsh 树解析，并与官方 `standard` 预设的插件 id 清单比对漂移 —— 把 issue #5 那类「引用上游已移除的包 → 新建会话点了没反应」挡在发布前
  - 上游其他变化：Session 日志升 V4（带 v3→v4 迁移器）；内置预设包重构（`dsh-agent-presets` → `dsh-agent-preset` + `dsh-agent-preset-registry` + `dsh-web-app/presets/*.patch.yml`）；依赖由 `^0.1.x` 改为**精确钉版**；`dsh-llm-deepseek` 拆为 account/api-key 两包；新增 `dsh-skill-office`/`dsh-experimental-auto-review`/`dsh-tool-workspace-dependencies`；侧边栏终端、MCP 资源、SSH 远端工作区、插件管理页运行时卸载等
  - **给已安装用户的提示**：旧 `~/.dsh/.agent-presets/` 目录不再被读取（保留无害，可自行删除）；若自建过 harmony-* 预设，需按官方「legacy preset 迁移」改成 bundle/声明行后才可见
- **v0.12.1** (2026-09-19) — **修复内置预设 harmonyos-chat 挂载失败**（[issue #5](https://github.com/ystyle/dsh-harmonyos/issues/5)）
  - 根因：内置预设仍引用上游 0.1.6 已移除的 `@deepseek-ai/dsh-workflow-worker-thread`（v0.11.0 已改为 `dsh-workflow-ptc`，但 v0.12.0 模板未同步）→ 新会话挂载预设失败，前端仅 console.warn，表现为「新建会话按钮点了没反应」
  - 同步官方 0.1.6-alpha.2 standard 预设：`workflow-worker-thread` → `workflow-ptc`；`tool-ralph` 补 `disabled: true`；新增 `tool-plugin-manager` 行（disabled）
  - 已修复用户侧 `$DSH_HOME/.agent-presets/` 下全部预设（harmonyos-chat + 6 个 harmony-* 旧预设），并对所有预设逐行 `require.resolve` 全量校验通过
  - **给已安装用户的提示**：升级后如旧预设仍报错，删掉 `~/.dsh/.agent-presets/<预设>/agent.cordis.yml` 让启动器重新 seed，或手动把 `dsh-workflow-worker-thread` 改成 `dsh-workflow-ptc`
- **v0.12.0** (2026-09-17) — 适配官方 dsh **0.1.6-alpha.2**
  - 官方 `@deepseek-ai/dsh` → **0.1.6-alpha.2**；7 个 fork 包升到 `0.1.6-alpha.2-harmony.1`（`node-addon-system` 上游仍 0.1.2 不变）；原生依赖 koffi 3.3.0 / node-pty / sharp-wasm / ripgrep **零变化** → prebuilt 全部复用
  - 补丁面：7/8 fork patch 在 alpha.2 基座原样通过；仅 `dsh-attachment-local` 第一 hunk 上下文适配——上游把 `import sharp` 改为**懒加载**（新依赖 `@deepseek-ai/dsh-lazy-require`，sharp wasm 不再启动时加载，对我们有利）；27 处残余锚点全命中（permission-presets/settings/client-connection 零漂移）
  - **新增补丁 `node-addon-require-builtin` JS 回退**：alpha.2 起插件依赖默认「运行时解析」（resolutionMode 默认 runtime），启动必经 `internalModules()` 加载该包的原生 binding；鸿蒙（openharmony-arm64，归一后 linux-arm64-musl）无平台二进制 → 启动即崩。该包是「无白名单」变体（requireBuiltin 原样转发、isAllowedInternalId 恒 true），等价语义 = 直接 require；启动器已带 `--expose-internals`（worker 继承 execArgv 同样可用），故原生加载失败时回退 JS 直读内部模块（新增 patch.mjs 条目 + anchors 预检锚点）
  - 上游变化：CLI 支持 `dsh <profile>` 位置参数（`--profile` 兼容）；`cordis-plugin-hmr` → 官方新包 `dsh-hmr`；新增 `dsh-plugin-manager`/`dsh-client-ui-cordis`（插件管理页）；**动态 Cordis 工具被移除**（`cordis_define/cordis_run/cordis_stop/cordis_undefine/cordis_inspect_self`，只留只读 inspect_list/query）——插件能力改走 Plugin Manager，属上游产品决策
  - **注意**：alpha.2 的 typert-loader 强制 codec `create()` 工厂格式，旧版第三方插件会启动报错。用户 profile 里的 `dsh-cost-meter` 需 **≥ 1.7.28**（已在本机更新 1.7.22→1.7.28）
  - 验证：`npm ci` 全新安装 → 8 fork 全解析 + patch 全绿（含新 requireBuiltin 条目）+ smoke PASS（全新 home 与真实 home 双测）；测试实例 58 个客户端 entry 全部 200、`client-resources` 在装配清单
- **v0.11.0** (2026-09-15) — 适配官方 dsh **0.1.6-alpha.1**（大版本更新）
  - 官方 `@deepseek-ai/dsh` → **0.1.6-alpha.1**；8 个 fork 包 7 个升到 `0.1.6-alpha.1-harmony.1`（`node-addon-system` 上游仍 0.1.2 不变）；`prebuilt/koffi-3.3.0-linux-arm64-musl.node`（koffi 3.2.1→3.3.0，源码编译 + AGC 签名）
  - 补丁面：**27 处残余锚点零改动**（官方在关键路径与 rc.2 一致），仅 `dsh-tool-fs-search` 的 `resolveRgPath` 重构（`return …rgPath` → `const dependency = …`），fork patch 与 anchors 锚点同步更新；`dsh-attachment-local` fork patch 按 0.1.6 上游微调（import 无 `copyFile`、`unlink` 无 `.catch`）重新生成
  - 上游移除 `dsh-code-runtime`/`dsh-workflow-worker-thread`（Node PTC 独立进程化 → `dsh-ptc-runtime`/`dsh-workflow-ptc`，纯 JS 无原生风险）；新增 terminal/unarchive-sessions/image-offload 等客户端插件均进装配清单
  - 验证：`npm ci` 全新安装 → 8 fork 全解析 + patch 全绿 + preflight 27/27 + smoke PASS（token 303+cookie → / 200）；真实 Chrome（CDP）→ **59 个客户端 entry 全部 200、`client-resources` 在清单、pending:false、聊天框正常**（0.1.6 装配改为逐 entry 独立 URL，`restoreForkNames` 依旧关键）
- **v0.10.5** (2026-09-11) — **修复 node-addon-system/flock 嵌套实例漏补丁（会话 resume 失败根因）**
  - 根因：`patchNodeAddonFlock()` 此前只会补 `node_modules/@deepseek-ai/node-addon-system` 顶层一份，但 npm 嵌套布局下 `dsh-session-persistence-jsonl`、`dsh-sandbox-local` 各自还带一份 `@deepseek-ai/node-addon-system`（上游 0.1.2）→ 运行时解析到未补丁的嵌套副本 → 打开/恢复历史会话报 `Cannot find module '@deepseek-ai/node-addon-system-linux-arm64/package.json'`（`gateway/internal: resume failed`）
  - 修复：新增 `nodeAddonFlockFiles()` 按包名递归定位**全部** `lib/flock.js` 实例，`patchEvery` 逐实例打补丁；校验段同步改为逐实例校验（漏打任意一份即报错）
  - 影响：0.10.2 的「嵌套布局加固」只覆盖了走 `allInstances()` 的补丁，`patchNodeAddonFlock` 是唯一硬编码顶层路径的漏网之鱼；本次一并修掉
- **v0.10.4** (2026-09-11) — **修复 web boot pending 根因：fork 包名还原**
  - 根因：`sync-forks` 发布 fork 时把 package.json `name` 改为 `@dsh-harmonyos/*`（npm publish 要求），但 dsh 的 `client-modules` 用「`name === 声明名`」严格匹配收集客户端插件（`nearestPackage`）→ fork 名不匹配 → `dsh-client-resources` 被剔除出 web 装配清单 → `resources` 服务缺失 → 5 个客户端插件 pending、聊天框不出现
  - 修复：启动器每次启动执行 `restoreForkNames()`（幂等）——把 8 个 fork 包 `name` 改回官方名（目录名本就是官方名；`version` 保留 `-harmony.N` 区分 fork）
  - 验证：真实 Chrome（CDP）全新安装 0.10.4 → 打包端点恢复 54 模块（含 client-resources）→ pending 消失、聊天框出现、界面正常；0.10.0（官方包名）从未有此问题，佐证根因
- **v0.10.3** (2026-09-11) — koffi/node-pty 全实例铺位（嵌套布局完整可用）
  - `findPkgDirs` 递归找全部实例（深度 20）：嵌套布局下 koffi 可深达 13 层（`dsh→dsh-base→dsh-sandbox-local→dsh-sandbox-windows-acl→koffi`），此前只铺顶层/浅层 → 深层实例无二进制 → boot 报 `Cannot find the native Koffi module`
  - 实测（嵌套布局干净树）：koffi 全实例铺位 + `dsh web` + 模拟浏览器 303 + **0 pending** 全通过
- **v0.10.2** (2026-09-11) — 嵌套布局加固：patch 深挖 10 层 + 空实例容错
  - `locatePkgFiles` 深度 6→10：npm 嵌套布局下 dsh 的依赖可深达 7 层（`dsh/node_modules/@deepseek-ai/…`），6 层会漏掉 `dsh-settings` 等残余补丁目标导致自愈失败
  - `patchEvery` 空实例不再中断：嵌套布局下 npm 可能漏装传递依赖（如 `dsh-client-connection`），改为显式警告 + skipped，其余可打补丁照常打
  - 注：**标准 `npm i -g` 的默认布局就是包内嵌套**（`<prefix>/lib/node_modules/<pkg>/node_modules/...`）；0.10.3 起嵌套与平铺布局均已完整支持（patch 深挖 + koffi/node-pty 全实例铺位），0.10.2 的"推荐平铺"措辞已过时
- **v0.10.1** (2026-09-11) — 修复 fork 固化在 `npm i -g` 场景不生效 + 平铺布局支持
  - **overrides → dependencies 别名**：npm 的 `overrides` 只在「命令根项目」生效，`npm i -g dsh-harmonyos` 时包内 overrides 被忽略 → fork 装不上、退回全量打补丁。改为 dependencies 里的 `npm:` 别名（`"@deepseek-ai/dsh-fs-local": "npm:@dsh-harmonyos/dsh-fs-local@…"`），任意安装场景都解析到 fork
  - **定位逻辑抽为 `lib/locate.mjs`**（启动器/patch/prune/anchors 共用）：支持平铺（标准 `npm -g` 依赖平铺到 node_modules 容器）与嵌套两种布局，此前启动器只认包内 node_modules，平铺安装直接报「未找到 dsh」
  - 实测：`npm install --prefix`（等价 `-g`）装新 tarball → 8 个 fork 顶层全就位、首启 patch 仅打 3 个残余补丁（permission/settingsCompat/loopbackAuth）、启动正常
- **v0.10.0** (2026-09-11) — fork + overrides 固化（安装零补丁）
  - 官方 `@deepseek-ai/dsh` → **0.1.5-rc.2**（与 rc.1 仅依赖版本号升级，源码零差异，prebuilt 无需重做）
  - 8 个平台语义改动固化为 `@dsh-harmonyos/*` fork 包（`fork-patches/*.patch` diff 即真值），`package.json` overrides 经 `npm:` 别名接入 → 安装即正确，patch.mjs 对应条目因标记幂等自动退役，残余（回环免 token、settings 垫片等）仍兜底
  - 工具链：`scripts/forks-list.mjs`（FORKS 单一事实源）、`sync-forks`（重建/校验/发布）、`cutover`（overrides 切换）；CI 增加 fork 重建门禁；`preflight` 改为 fork 文件跳过 + 残余锚点核对
  - 验证：`npm ci --ignore-scripts` 后 13 处 fork 实例全解析 + preflight 全绿 + smoke PASS
- **v0.9.0** (2026-09-10) — 新增内置系统提示词预设（`harmonyos-chat`）
  - 仓库携带 `presets/harmonyos-chat/`（基于官方 `standard` 的完整编码 Agent），persona 预置鸿蒙运行环境说明（鸿蒙内核 / `target=linux-aarch64-ohos` / 与 Linux ABI 兼容但非 Linux / `/tmp` 只读 / 临时文件写 `$TMPDIR`=~/.cache），新会话开箱即带系统提示词
  - 启动器首启自动 seed 到 `~/.dsh/.agent-presets/harmonyos-chat/` 并设为默认预设（用户已设置过默认则不覆盖）；`DSH_OHOS_PRESET=off|<id>` 可关闭/改名
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
