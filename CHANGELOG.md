# Changelog — dsh-harmonyos

本文件记录每个发行版**做了什么、为什么**（根因、验证方式、迁移提示）。
面向用户的安装/使用说明见 [README.md](README.md)，
维护者与 Agent 的操作手册见 [AGENTS.md](AGENTS.md)。

格式：`- **v<版本>** (日期) — 一句话主题`，其下为要点。
版本号与官方 dsh 版本是两条线：**发行版**（本文件）与 **fork 包**（`<上游版本>-harmony.<n>`）。

## 版本历史

- **v0.13.2** (2026-09-25) — **koffi 预编译改用证书签名 + 启动器如实报告签名**
  - 问题：0.13.1 随包的 `prebuilt/koffi-3.3.1-…node` 是**本地源码编译 + 自签**（`-selfSign 1`）产物，
    而仓库其它预编译（node-pty）是**证书签名**。更糟的是启动器无条件打印「AGC 签名」，
    changelog 也照抄了 —— 属于**误报**（判断依据是「文件里含 codesign 字符串」，那不能证明签名类型）
  - 修复：① 重新从源码构建**未签名**的 koffi 3.3.1，用 `hmsign-release`（zsh function）以
    **证书签名**重新产出 prebuilt（Subject 与 `prebuilt/node-pty` 同一张华为 CBG DevID 证书）；
    ② 启动器新增 `describeSignature()`，铺位时**实测**签名并如实打印
    （`证书签名(...)` / `自签(self-sign, 非证书签名)` / `未签名`），不再做任何假设
  - 说明：`prebuilt/koffi-3.2.1`、`koffi-3.3.0` 仍是历史自签产物（仅作旧版本兜底）；
    当前 `koffi` 已精确钉在 **3.3.1**，实际使用的是证书签名那份
  - 验证（全新全局嵌套安装）：启动输出 `使用预编译 koffi(3.3.1, 证书签名)`、编译输出 0 行、
    三 triplet 铺位齐全、`display-sign` 实测为证书签名；smoke / preset-check / anchors 全 PASS
- **v0.13.1** (2026-09-25) — **修复 koffi 版本漂移导致回退源码编译**
  - 现象：升级到 0.13.0 后首次启动打印「编译 koffi(源码, 需 clang/cmake)… Failed to load prebuilt binary, rebuilding from source」，不再用仓库自带的预编译
  - 根因：上游依赖写的是 `koffi ^3.1.0`（不是精确钉版），0.13.0 重新生成 `package-lock.json` 时 npm 解析到了最新的 **3.3.1**，而仓库只带 `prebuilt/koffi-3.3.0-…node` → 版本对不上 → 按设计回退源码编译（本机有 clang/cmake 所以能过）
  - 修复：① 随包新增 `prebuilt/koffi-3.3.1-linux-arm64-musl.node`；② 在 `dependencies` 里**精确钉住 `"koffi": "3.3.1"`**（与 `@img/sharp-wasm32`/`zstd-codec` 同一手法），杜绝再次静默漂移；③ 启动器在缺少配套预编译时明确报出「本机 koffi 版本 + 仓库自带哪些版本 + 版本漂移通常是没钉住 koffi」
  - 验证（全新全局嵌套安装）：启动输出使用预编译、**编译输出 0 行**、三个 triplet 铺位齐全；smoke PASS、preset-check PASS、anchors PASS
  - ⚠️ 该版本的 koffi 预编译为自签产物，签名问题在 **v0.13.2** 修正
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
