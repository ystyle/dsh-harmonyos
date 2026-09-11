// forks-list: @dsh-harmonyos/* fork 清单 —— 唯一事实源。
//
// 被 sync-forks.mjs(重建/发布) 与 cutover-overrides.mjs(overrides 切换) 共用,
// 避免两份清单漂移(如版本号升级只改了一处导致 overrides 指向不存在的版本)。
//
// version 必须与 package.json 里 @deepseek-ai/dsh 的 pin 同步(上游升级时一起升)。
// harmony 序号: fork 自身修复时 +1, 重新跟随上游版本时回到 1。
// markers: diff 应用后产物必须包含的标记(等价于旧 lib/anchors.mjs 的语义)。
export const FORKS = [
  {
    fork: '@dsh-harmonyos/dsh-session-persistence-jsonl',
    upstream: '@deepseek-ai/dsh-session-persistence-jsonl',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-session-persistence-jsonl.patch',
    markers: [
      'HarmonyOS patch: publishCurrentExclusive',
      'HarmonyOS patch: 本机不支持硬链接(EPERM)，link→rename',
    ],
  },
  {
    fork: '@dsh-harmonyos/dsh-attachment-local',
    upstream: '@deepseek-ai/dsh-attachment-local',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-attachment-local.patch',
    markers: [
      'HarmonyOS patch: publishImmutableAlias',
      'HarmonyOS patch: 部分挂载点/目录无法以只读句柄打开',
    ],
  },
  {
    fork: '@dsh-harmonyos/dsh-fs-local',
    upstream: '@deepseek-ai/dsh-fs-local',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-fs-local.patch',
    markers: ['HarmonyOS /storage mounts reject hard links'],
  },
  {
    fork: '@dsh-harmonyos/node-addon-system',
    upstream: '@deepseek-ai/node-addon-system',
    version: '0.1.2',
    harmony: 1,
    patch: 'node-addon-system.patch',
    markers: ['HarmonyOS no-op memory flock'],
  },
  {
    fork: '@dsh-harmonyos/dsh-client-resources',
    upstream: '@deepseek-ai/dsh-client-resources',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-client-resources.patch',
    markers: ['HarmonyOS patch: protocolOf 手动回退'],
  },
  {
    fork: '@dsh-harmonyos/dsh-tool-fs-search',
    upstream: '@deepseek-ai/dsh-tool-fs-search',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-tool-fs-search.patch',
    markers: ['DSH_RG_PATH'],
  },
  {
    fork: '@dsh-harmonyos/dsh-credentials-local',
    upstream: '@deepseek-ai/dsh-credentials-local',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-credentials-local.patch',
    markers: ['HarmonyOS patch: 文件系统强制组位'],
  },
  {
    fork: '@dsh-harmonyos/dsh-sandbox-policy',
    upstream: '@deepseek-ai/dsh-sandbox-policy',
    version: '0.1.5-rc.2',
    harmony: 1,
    patch: 'dsh-sandbox-policy.patch',
    markers: ['DSH_OHOS_FORCE_DANGER'],
  },
  // 待定/后置: loopbackAuth(先做配置化调研)、vision(可选插件, 未安装)。
  // C 类(升版删除, 不 fork): settingsCompat / permission / cordisLoader。
];

/** fork 发布版本 = 上游版本 + -harmony.<n> 后缀。 */
export function forkVersion(f) {
  return `${f.version}-harmony.${f.harmony}`;
}
