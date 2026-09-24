# @dsh-harmonyos/preset-harmonyos-chat

dsh-harmonyos 的内置 agent 预设 `harmonyos-chat`，以 **bundle 声明**形式分发。

## 这是什么

0.1.7-rc.2 起，dsh 的 agent 预设不再是 `$DSH_HOME/.agent-presets/<id>/` 目录（该目录已无人读取），
而是普通的 `@deepseek-ai/dsh-agent-preset` 声明行，由 bundle patch 承载。

本包即一个 bundle：

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`
- `cordis.patch.yml` 用 `- insert:` 声明预设 `harmonyos-chat`，并把 `agent-preset-registry`
  的 `default` 覆盖为该预设

`dsh-harmonyos` 把本包作为依赖安装，启动器再把包名加入 profile 的 `dsh.profile.bundles`
（bundle 解析优先取 dsh 安装目录，因此无需装进 profile），于是每个新会话默认挂上它 ——
系统提示词开箱自带鸿蒙运行环境说明。

## 内容

声明里的插件行与官方 `standard` 预设逐行一致（shell / 文件 / 检索 / Skills / 计划 / 目标 /
子代理 / 工作流），唯一差别是 persona `prefix`：写入鸿蒙运行环境说明
（鸿蒙内核、`target=linux-aarch64-ohos`、与 Linux ABI 兼容但非 Linux、`/tmp` 只读、
`$TMPDIR=~/.cache`）。

插件 id 清单漂移由 `npm run preset-check` 在发布前比对，防止出现「引用了上游已移除的包」
导致预设挂载失败。

## 关闭

设 `DSH_OHOS_PRESET=off` 后启动器不再把本 bundle 加入 profile。
