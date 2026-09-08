// node:zlib 兼容层: node 22.7 缺原生 zstd(22.16+) 的 createZstdCompress/createZstdDecompress。
// 优先用「原生」zstd(node>=22.16): 它与写入端一致, 能正确解开原生 zstd 帧(否则会报
// "corrupt Zstandard session log")。仅当原生缺失(如 node22)时才回退到 zstd-codec(wasm)。
// 其余导出原样透传。
export * from 'node:zlib';
import { Transform } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const zlib = require('node:zlib');

// 原生 zstd 是否可用 (node >= 22.16)
const NATIVE_ZSTD = typeof zlib.zstdDecompressSync === 'function' &&
  typeof zlib.zstdCompressSync === 'function' &&
  typeof zlib.createZstdDecompress === 'function' &&
  typeof zlib.createZstdCompress === 'function';

// 仅当原生缺失时, 才初始化 wasm zstd-codec (顶层 await; 原生可用则跳过, 不加载 wasm)。
let wasm = null;
if (!NATIVE_ZSTD) {
  const { ZstdCodec } = require('zstd-codec');
  const codec = await new Promise((resolve) => ZstdCodec.run((z) => resolve(z)));
  wasm = new codec.Simple();
}

const toU8 = (b) => (b instanceof Uint8Array ? b : Buffer.from(b));

function zstdStream(kind) {
  return class ZstdStream extends Transform {
    constructor(options = {}) {
      super(options);
      this._chunks = [];
    }
    _transform(chunk, _enc, cb) {
      this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    }
    _flush(cb) {
      try {
        const buf = Buffer.concat(this._chunks);
        if (NATIVE_ZSTD) {
          const out = kind === 'decompress'
            ? zlib.zstdDecompressSync(buf)
            : zlib.zstdCompressSync(buf, { level: 3 });
          this.push(Buffer.isBuffer(out) ? out : Buffer.from(out));
        } else {
          const input = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          const out = kind === 'decompress' ? wasm.decompress(input) : wasm.compress(input, 3);
          if (!out) return cb(new Error('zstd ' + kind + ' failed'));
          this.push(Buffer.from(out));
        }
        cb();
      } catch (e) { cb(e); }
    }
  };
}
export function createZstdCompress(options) {
  // 原生有 zstd 时返回「原生流」(带 .close/.destroy, 与写入端一致); wasm 路径才用自定义 Transform。
  if (NATIVE_ZSTD) return zlib.createZstdCompress(options);
  return new (zstdStream('compress'))(options);
}
export function createZstdDecompress(options) {
  if (NATIVE_ZSTD) return zlib.createZstdDecompress(options);
  return new (zstdStream('decompress'))(options);
}

export function zstdCompressSync(buf, options) {
  if (NATIVE_ZSTD) return zlib.zstdCompressSync(buf, { level: options?.level ?? 3 });
  return Buffer.from(wasm.compress(toU8(buf), options?.level ?? 3));
}
export function zstdDecompressSync(buf, options) {
  if (NATIVE_ZSTD) return zlib.zstdDecompressSync(buf);
  return Buffer.from(wasm.decompress(toU8(buf)));
}
export function zstdCompress(buf, options, cb) {
  if (typeof options === 'function') { cb = options; options = undefined; }
  const run = () => { try { return zstdCompressSync(buf, options); } catch (e) { throw e; } };
  if (typeof cb === 'function') { try { cb(null, run()); } catch (e) { cb(e); } return; }
  return Promise.resolve().then(run);
}
export function zstdDecompress(buf, options, cb) {
  if (typeof options === 'function') { cb = options; options = undefined; }
  if (typeof cb === 'function') { try { cb(null, zstdDecompressSync(buf, options)); } catch (e) { cb(e); } return; }
  return Promise.resolve().then(() => zstdDecompressSync(buf, options));
}
