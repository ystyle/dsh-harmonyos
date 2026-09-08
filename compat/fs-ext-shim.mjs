// fs-ext 兼容层: 鸿蒙(openharmony-arm64)无编译好的 fs_ext.node, 官方 browser worker 部署
// 就是把 fs-ext stub 成「立即成功」——单进程下 in-process write claim 已排除所有写者。
// 鸿蒙 dsh 同为单进程场景, 照搬该方案: flock(fd, flags, cb) 立即回调成功。
// 影响: session.lock 的 POSIX flock 失效, 但单进程内写锁语义由 in-process claim 保证。
export function flock(_fd, _flags, callback) {
  if (typeof callback === 'function') callback(null);
}
export default { flock };
