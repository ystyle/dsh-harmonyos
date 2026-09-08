// sharp 兼容层: 鸿蒙(openharmony-arm64)无 sharp 预编译二进制。dsh-attachment-local 的
// 图像探测/归一化/变体全部依赖 sharp; 不可用时调用方会把异常包装成 INVALID_IMAGE
// ("Unsupported or malformed image data."), 图片附件走「不支持」路径, 普通附件/会话不受影响。
// 抛错信息带 `code: "SHARP_UNAVAILABLE"`, 便于上层诊断。
export default function sharpUnavailable() {
  const error = new Error('sharp is not available on HarmonyOS (openharmony-arm64 has no prebuilt binary)');
  error.code = 'SHARP_UNAVAILABLE';
  throw error;
}
