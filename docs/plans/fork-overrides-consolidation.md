# 固化方案：从"安装时锚点打补丁"到"fork + npm overrides 别名"

> 状态：**M0/M1/M2 全部落地，v0.10.0 已发布；v0.10.1 修正 overrides → dependencies 别名** · 日期：2026-09-11 · 作者：dsh-harmonyos 维护者
>
> 进度快照：
> - ✅ M0：`sync-forks` 管道（拉上游 tarball → git apply diff → 标记校验 → 改 manifest）+ `file:` 别名验证（单包）
> - ✅ M1：8 个 fork 的 `fork-patches/*.patch` 全部生成并验证（标记齐全、`git apply` 干净、8/8 解析到 fork）
> - ✅ 工具：`scripts/sync-forks.mjs`（sync/--publish/--check/--materialize）、`scripts/cutover-overrides.mjs`（别名同步）、`.github/workflows/forks.yml`
> - ✅ v0.10.0：fork 发布 + 本体发布（当时用 `overrides` 接入）
> - ✅ v0.10.1：**关键修正 —— `overrides` 只在命令根项目生效，`npm i -g` 安装 dsh-harmonyos 时包内 overrides 被 npm 忽略** → 改为 `dependencies` 里的 `npm:` 别名（任意安装场景生效）；启动器/patch/prune/anchors 定位抽为 `lib/locate.mjs`，支持平铺与嵌套布局
> - 关键实现细节：`.forks-out/` 位于本仓库内，`git apply` 前必须 `git init`（否则解析到外层仓库根）；patch.mjs 各函数按自身标记幂等，fork 装进来后自动 no-op 退役
> 目标读者：本仓库维护者。本文解决一个具体问题：**把 `lib/patch.mjs` 这套安装时锚点打补丁的脆机制，换成"源码本来就是对"的固定机制。**

---

## 1. 背景与问题

### 1.1 现状

dsh-harmonyos 为了让官方 `@deepseek-ai/dsh`（目前 0.1.5-rc.1）在鸿蒙 PC 上跑通，维护了多层适配：

| 层 | 机制 | 稳定性 |
|---|---|---|
| 组合层 | `overlays/harmonyos.patch.yml`（`--patch` overlay，行-id 级覆盖） | ✅ 天然稳定，升级健壮 |
| **源码层** | **`lib/patch.mjs`：14 处锚点补丁，直接改写 `node_modules` 里官方包的源码** | ❌ 本文要解决的主体 |
| 兼容层 | `compat/*`（平台归一、zlib/fs-ext/sharp/koffi shim） | ✅ 仓库自有代码 |
| 启动层 | `bin/dsh-ohos.js`（自愈重打补丁、seed、锁清理） | ⚠️ 依赖源码层 |

`lib/patch.mjs` 的现状：
- 精确代码片段锚点替换，**锚点失配即报错拒绝**（绝不静默打错）——这是优点也是脆点；
- `npm install` 会冲掉补丁 → 靠启动器"marker 版本不一致自动重打"自愈；
- 官方升级后锚点可能漂移 → 靠 `lib/anchors.mjs` 的 `npm run preflight` 在**未打补丁树**上预检，但这是"装完才发现"的补救，不是根除；
- npm 11 嵌套布局可能出现同包多实例 → 补丁必须逐一命中所有实例。

### 1.2 痛点

1. **安装时补丁 = 每次安装/升级都在赌锚点**；自愈逻辑（marker、重打、校验）本身也是复杂度。
2. **官方仓库不收外部 PR**（CONTRIBUTING.md 原文："we cannot accept external pull requests at the moment"）→ 不能指望把修复推回上游来"免费"获得。
3. 14 处补丁里混着三种性质完全不同的东西：平台语义差异、防御性健壮修复、版本兼容 shim —— 应该分开处置。

### 1.3 目标与非目标

**目标**
- 让"鸿蒙需要的源码改动"变成**固定的、版本化的、安装时零动作**的机制；
- `npm install` 后即正确，不再需要启动器自愈重打源码补丁；
- 官方 dsh 升级的适配工作收拢到**一条生成脚本 + 预检**，而不是散在安装时。

**非目标**
- 不改动官方组合层语义（overlay 机制保留）；
- 不做大范围 fork（只 fork 必须改源码的包）；
- 不在本方案内实现（另立任务）：回环免 token 的配置化调研、上游 issue 跟踪。

---

## 2. 总体架构：三层固化

```
┌─ 组合层（保持现状）────────────────────────────┐
│  overlays/harmonyos.patch.yml                  │  ✅ 已是"固定"机制
│  profiles/*/cordis.patch.yml                   │
└───────────────────────────────────────────────┘
┌─ 源码层（本方案主体：fork + overrides）──────────┐
│  @dsh-harmonyos/<pkg>  ← fork 上游包,改动写死在源码 │
│  package.json "overrides" 别名强制解析到 fork     │  ✅ 安装零补丁
│  生成脚本 scripts/sync-forks.mjs 负责升级同步      │
└───────────────────────────────────────────────┘
┌─ 兼容层 / 启动层（保持现状）────────────────────┐
│  compat/*   bin/dsh-ohos.js   lib/prune.mjs     │  ✅ 仓库自有代码
└───────────────────────────────────────────────┘
```

关键点：**补丁从"安装时应用"变成"构建时（fork 发布时）应用"** —— 改动以 diff 文件的形式版本化在本仓库，生成脚本在发布 fork 包时应用一次，之后 npm 直接解析到已经是对的包。

---

## 3. 补丁分类清单（现状 → 去向）

### A 类：平台语义差异 → fork 固化（`@dsh-harmonyos/*`）

| # | 补丁（patch.mjs） | 目标包 | 改动内容 | fork 优先级 |
|---|---|---|---|---|
| 1 | `patchSession`（2 点） | `dsh-session-persistence-jsonl` | link()→rename()（新会话落盘 + v2→v3 迁移） | **P1** |
| 2 | `patchAttachment` + `patchAttachmentAlias` | `dsh-attachment-local` | link→rename / copyFile+COPYFILE_EXCL（别名发布） | **P1** |
| 3 | `patchFsLocal` | `dsh-fs-local` | createIfAbsent link→rename | **P1** |
| 4 | `patchNodeAddonFlock` | `node-addon-system` | 原生 flock 绑定 → 纯 JS stub（平台分发装不上） | **P1** |
| 5 | `patchClientResources` | `dsh-client-resources` | protocolOf 手动回退（ArkWeb 不透明 scheme） | P2 |
| 6 | `patchFsSearch` | `dsh-tool-fs-search` | `DSH_RG_PATH` 环境变量覆盖 rg 路径 | P2 |
| 7 | `patchCredentials` | `dsh-credentials-local` | chmod 600 属主检查跳过 | P2 |
| 8 | `patchLoopbackAuth` | `dsh-client-connection` | 回环免 token | P3（先试配置化，见 §5.4） |
| 9 | `patchSandboxPolicy` | `dsh-sandbox-policy` | 默认 mode=danger（已被 env 兜底） | P3（可并入 1-4 或直接删） |

### B 类：仓库自有代码，零上游依赖（不动）

`overlays/*`、`compat/*`、`bin/dsh-ohos.js`、`lib/prune.mjs`、`lib/anchors.mjs`、`presets/*`、`.github/workflows/*`。

### C 类：版本兼容 shim → 随上游版本演进删除（不 fork）

| # | 补丁 | 说明 | 处置 |
|---|---|---|---|
| 1 | `patchSettingsCompat` | dsh-settings 旧导出恢复 | 升版时核对，新版自带即删 |
| 2 | `patchPermission` | 0.1.3→0.1.5 sandboxMode API 适配 | 升版时核对删 |
| 3 | `patchCordisLoader` | cordis-loader v0 补丁 | node26 已自动跳过，直接删逻辑 |

---

## 4. 详细设计

### 4.1 fork 包命名与版本

- 命名：`@dsh-harmonyos/<pkg>`（与上游同名不同 scope）。
- 版本：**跟随上游版本 + 自有后缀**，保证 semver 排序与上游一致：
  - 上游 `0.1.5-rc.1` → fork `0.1.5-rc.1-harmony.1`（后续我们自己的修复 `-harmony.2`…）；
  - 上游发正式版 `0.1.5` → fork `0.1.5-harmony.1`（在正式版基础上重建，丢弃 rc 系列）。
- 发布：fork 包各自 `npm publish`（公开，unscoped 规则不适用 → scoped 包加 `--access public`）。

### 4.2 package.json `overrides` 映射

```jsonc
{
  "overrides": {
    "@deepseek-ai/dsh-session-persistence-jsonl": "npm:@dsh-harmonyos/dsh-session-persistence-jsonl@0.1.5-rc.1-harmony.1",
    "@deepseek-ai/dsh-attachment-local":           "npm:@dsh-harmonyos/dsh-attachment-local@0.1.5-rc.1-harmony.1",
    "@deepseek-ai/dsh-fs-local":                   "npm:@dsh-harmonyos/dsh-fs-local@0.1.5-rc.1-harmony.1",
    "@deepseek-ai/node-addon-system":              "npm:@dsh-harmonyos/node-addon-system@0.1.5-rc.1-harmony.1",
    "@deepseek-ai/dsh-client-resources":           "npm:@dsh-harmonyos/dsh-client-resources@0.1.5-rc.1-harmony.1",
    "@deepseek-ai/dsh-tool-fs-search":             "npm:@dsh-harmonyos/dsh-tool-fs-search@0.1.5-rc.1-harmony.1",
    "@deepseek-ai/dsh-credentials-local":          "npm:@dsh-harmonyos/dsh-credentials-local@0.1.5-rc.1-harmony.1"
  }
}
```

效果（顺带解决老问题）：
- **npm 11 嵌套布局的多实例**问题消失 —— overrides 对整棵树强制解析，所有实例都落到 fork；
- 安装即正确，启动器自愈不再需要"重打源码补丁"这一支（marker 逻辑可简化/保留仅作版本核对）。

### 4.3 改动载体：diff 文件即源码真值（不建 fork 仓库）

fork 的改动不靠安装时锚点替换，也不靠独立的 fork 源码仓库 —— **源码真值就是本仓库里版本化的 diff 文件**，fork 包 = "上游发布物 tarball + diff"由脚本临时重建后发布：

```
fork-patches/
  dsh-session-persistence-jsonl.patch     # 唯一真值：鸿蒙改动本身（几十行）
  dsh-attachment-local.patch
  dsh-fs-local.patch
  node-addon-system.patch
  dsh-client-resources.patch
  dsh-tool-fs-search.patch
  dsh-credentials-local.patch
```

- 为什么**不建新 git 仓库**：7 个包 = 7 套 README/issues/CI 的维护负担，对个人维护者不可持续；真正需要维护的资产只有"鸿蒙改动"（= diff），它放在本仓库与消费方同处一地，升级流程天然闭环。
- diff 由"上游源码 + 现在的 patch.mjs 锚点替换逻辑"半自动生成（M1 阶段一次性产出）；
- 需要看 fork 完整源码时：`sync-forks --materialize` 把"上游 tarball + diff"落盘到临时目录（fork 改动都很小，diff 一眼可读完）。

### 4.4 生成/同步脚本 `scripts/sync-forks.mjs`（接口规范）

```text
npm run sync-forks [命令] [--publish]

命令（默认 = sync）:
  sync          重建并校验所有 fork（拉上游 tarball → git apply diff → 校验），不发布
  --publish     校验通过后发布 @dsh-harmonyos/<pkg>@<ver>-harmony.<n>，并回写 overrides
  --materialize 把"上游 tarball + diff"落盘到 .forks-out/<pkg>/（调试看完整源码用）
  --check       只校验 diff 可应用性（CI 用, 不落盘不发布）

流程（sync/publish）:
  1. 读取 package.json 的 dsh 版本 pin（@deepseek-ai/dsh@X, 两处同步升）
  2. 对 fork-patches/ 下每个目标包:
     a. npm pack 上游包@X（--ignore-scripts, 到 .forks-out/）
     b. git apply fork-patches/<pkg>.patch —— 失败即 exit≠0, 列出失配行, 人工修 diff 后重试
     c. 校验: diff 应用后产物内核对关键标记（复用 lib/anchors.mjs 的锚点表语义）
     d. --publish 时: npm publish @dsh-harmonyos/<pkg>@X-harmony.<n> --access public
  3. --publish 时回写 package.json overrides 与 README

环境变量:
  NODE_AUTH_TOKEN  发布 fork 包所需（npm access token）
  FORK_REGISTRY    默认 https://registry.npmjs.org
  FORKS_ONLY=1     只重建 fork, 不动 dsh-harmonyos 本体
```

版本规则：fork 版本 = 上游版本 + `-harmony.<n>` 后缀（如 `0.1.5-rc.1-harmony.1`）；上游发正式版后在正式版上重建 fork（`0.1.5-harmony.1`），rc 系列弃用。

### 4.5 patch.mjs 退役路径

- overrides 生效后，对应补丁条目从 `patchAll()` 移除；`lib/anchors.mjs` 同步删锚点；
- 退役顺序与 fork 落地顺序一致（P1 → P2 → P3）；
- `patchAll()` 保留给**尚未 fork 的残余**（理论上最终为空，可整文件删除，marker 校验随之消失）；
- 启动器自愈：从"marker 版本不一致 → 重打补丁"简化为"marker 版本不一致 → 仅提示需升级/重装"（因为安装即正确）。

### 4.6 维护模型（已定：diff 即真值、无仓库）

维护对象是 `fork-patches/*.patch`，不是任何源码仓库。三档维护节奏：

| 场景 | 动作 | 频率 |
|---|---|---|
| **日常** | 什么都不做 —— fork 包发布一次后 overrides 一直指向它，`npm install` 即正确 | 常态 |
| **上游 dsh 升级** | `npm run sync-forks --publish`：拉新版 tarball → apply diff → 失败即列出失配行 → 修 diff（通常半小时内）→ 重跑 → 自动发 `@dsh-harmonyos/*@<新版本>-harmony.1` → 回写 overrides → 发 dsh-harmonyos 本体 | 每次官方升级 |
| **fork 自身修复** | 改 `fork-patches/<pkg>.patch` → 发 `-harmony.<n+1>` → 本体 overrides 升级指向 | 按需 |

调试 fork 内部：`npm run sync-forks --materialize` 落盘完整源码到 `.forks-out/`。

### 5. 决策点 / 风险（实施前需拍板）

| # | 决策点 | 选项 | 建议 |
|---|---|---|---|
| 5.1 | fork 的改动落在**编译产物**还是**源码 + 重新构建** | a) 直接改编译产物（现状 patch 就是改产物） b) fork 上游源码仓库, 构建产物 | **a)** 轻量、与现状等价；上游发布物即编译产物, fork 仓库只存产物+diff。b) 太重 |
| 5.2 | fork 包仓库形态 | **不建仓库**：diff 文件即源码真值, fork 包由 `sync-forks` 从"上游 tarball + diff"重建发布（模型③, 见 §4.3/§4.6） | **已定** —— 无仓库维护；对比: monorepo/每包一仓库负担过重, 已否决 |
| 5.3 | `node-addon-system` 是否值得 fork | a) fork 4) b) 保留 patch（改动极小, 单文件） | 可保留 patch 或 fork, 看维护成本; 默认 **fork**（消灭所有安装时补丁） |
| 5.4 | 回环免 token 配置化 | 核对官方 `trustedHosts`/web-runtime 配置面, 能配则删 `patchLoopbackAuth` | 先行调研, 能配则不进 fork |
| 5.5 | 上游版本节奏 | rc 频繁变动 → fork 同步成本高 | 只在**上游正式版或长命 rc** 上重建 fork；rc 之间用 overrides 指向已发布 fork 不动 |
| 5.6 | 与现有 `preflight` 的关系 | preflight 保留（对未 fork 残余）/ 转型为 fork 生成期校验 | 保留改名 `npm run check-forks`, 语义变为"diff 可应用性" |
| 5.7 | CI 整合 | fork 发布进 GitHub Actions（打 tag 自动发） | 复用现有 publish workflow 模式, 新增 `forks.yml` |

### 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| fork 滞后上游新版本 | 新版本修复/特性缺失 | 只在正式版重建 fork；`sync-forks` 脚本半自动；overrides 指向明确版本, 升级 dsh 时必须同步升级 fork（脚本强制） |
| npm `overrides` 别名下包内 `name` 与路径不一致 | 个别工具按 package.json.name 解析时困惑 | 功能层面无影响（别名是 npm 官方机制, 广泛用于 fork）；文档注明 |
| 发布 `@dsh-harmonyos/*` 增加发布面 | 每次上游升级要发 7+ 包 | 单脚本 + CI 一键；diff 文件固定, 重发成本低 |
| diff 与上游新版本冲突 | 同步失败 | `git apply` 失败即报错（同现状"锚点失配即拒绝"）, 人工修 diff 后重试 |

### 7. 分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0**（半天） | 选一个包（建议 `dsh-client-resources` 或 `dsh-session-persistence-jsonl`）跑通：生成 diff → 发 fork → 本仓库加 overrides → 隔离树 `npm ci` → 校验安装后源码即含改动、无自愈动作 | PoC 通过, 记录踩坑 |
| **M1**（1-2 天） | 批量生成 7 个 fork（P1+P2）+ `sync-forks.mjs` + CI `forks.yml` | 全新隔离树 `npm ci` 后 14 处补丁对应改动全部就位, patch.mjs 对应条目可退役 |
| **M2**（半天） | 退役 patch.mjs 条目 + 简化启动器自愈 + 更新 preflight 语义 | `npm run patch` 变空操作或删除; smoke 全绿 |
| **M3**（按需） | 回环免 token 配置化调研；C 类 shim 随版本删除；文档更新 | 补丁面收敛到最小 |

### 8. 验收标准（总体）

1. 全新环境 `npm i -g dsh-harmonyos@<新版本> --ignore-scripts` + 首启 dsh-ohos：
   - **无任何源码补丁动作**（启动日志无 "重打 patch/prune"），开箱即正确；
2. `npm run patch` 输出为空操作（或命令删除）；
3. 官方 dsh 升级流程 = 改 pin → `npm ci`（overrides 解析到新 fork）→ `npm run check-forks` → smoke，全程不碰运行时；
4. 现有 14 处补丁逐一有明确去向（fork / 配置化 / 删除），无"遗留且无主"的补丁；
5. CI：`forks.yml` 打 tag 自动发布 fork 包；`publish.yml` 发布 dsh-harmonyos 本体。

---

## 附录 A：patch.mjs 现状 → 去向总表

| patchAll 键 | 目标包 | 现状锚点数 | 分类 | 去向 |
|---|---|---|---|---|
| `credential` | dsh-credentials-local | 2 | A | fork（P2） |
| `session` | dsh-session-persistence-jsonl | 3 | A | fork（P1） |
| `permission` | dsh-permission-presets | 3 | C | 升版删除 |
| `attachment` / `attachmentAlias` | dsh-attachment-local | 4 | A | fork（P1） |
| `vision` | dsh-*-vision（可选） | - | A/B | 保持 patch 或并入 fork |
| `cordisLoader` | cordis-plugin-loader | - | C | node26 已跳过, 删除 |
| `settingsCompat` | dsh-settings | 1 | C | 升版删除 |
| `loopbackAuth` | dsh-client-connection | 4 | A | 配置化调研 / fork（P3） |
| `fsLocal` | dsh-fs-local | 1 | A | fork（P1） |
| `fsSearch` | dsh-tool-fs-search | 1 | A | fork（P2） |
| `sandboxPolicy` | dsh-sandbox-policy | 1 | A | 并入 fork 或保留 env 兜底后删 |
| `nodeAddonFlock` | node-addon-system | 3 | A | fork（P1） |
| `clientResources` | dsh-client-resources | 2 | A | fork（P2） |

## 附录 B：参考

- 官方 CONTRIBUTING.md："we cannot accept external pull requests at the moment"
- npm docs：`overrides`（含 `npm:` 别名）
- 本仓库 `lib/patch.mjs`、`lib/anchors.mjs`、`bin/dsh-ohos.js`、`overlays/harmonyos.patch.yml`

## 附录 C：`forks.yml` 草案（fork 包自动发布）

触发：push `forks-v*` tag（或手动）。跑 `sync-forks --publish` 发布全部 fork 包；跑完人工核对 `package.json overrides` 回写并发本体。

```yaml
name: forks

on:
  push:
    tags: ['forks-v*']
  workflow_dispatch:

permissions:
  contents: read

jobs:
  publish-forks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 26
          registry-url: https://registry.npmjs.org
          cache: npm

      - name: 安装依赖
        run: npm ci --ignore-scripts --no-audit --no-fund

      - name: 重建并发布 fork 包
        run: npm run sync-forks -- --publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # 发布后回写的 overrides 由维护者核对后随本体一起提交
      - name: 汇总结果
        run: git diff --stat package.json || true
```

> 与 `publish.yml` 的分工：`forks.yml` 发 `@dsh-harmonyos/*`（上游升级后重建 fork 用）；`publish.yml` 发 `dsh-harmonyos` 本体（overrides 已指向新 fork 后打 `v*` tag）。
