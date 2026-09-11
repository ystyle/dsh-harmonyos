// lib/locate.mjs: 定位「dsh 依赖容器」目录 —— 启动器 / patch / prune 共用, 避免三份漂移。
//
// 从 from 目录向上搜索首个含 @deepseek-ai/dsh 的依赖容器, 支持 npm 的两种安装布局:
//   布局 A(flat):   <dir>/node_modules/@deepseek-ai/<pkg>       依赖装进包内 node_modules
//   布局 B(nested): <dir>/@deepseek-ai/dsh/node_modules/…       嵌套 sibling 树
//   布局 C:         dir 本身是 node_modules 容器(内含 @deepseek-ai/) —— 标准 npm -g 平铺
// 返回「容器所在目录 D」, 调用方用 join(D, 'node_modules') 作为依赖根。
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

export function locateDshDir(from) {
  let dir = from;
  for (let i = 0; i < 8 && dir !== dirname(dir); i += 1, dir = dirname(dir)) {
    // 布局 A(flat): <dir>/node_modules/@deepseek-ai/<pkg>
    if (existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return dir;
    // 布局 B(nested): <dir>/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>
    if (existsSync(join(dir, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) {
      return join(dir, '@deepseek-ai', 'dsh'); // 其 node_modules 内是 sibling 树
    }
    // 布局 C: dir 本身是 node_modules 容器(内含 @deepseek-ai/)
    if (basename(dir) === 'node_modules' && existsSync(join(dir, '@deepseek-ai', 'dsh', 'package.json'))) return dirname(dir);
  }
  return from; // fallback: 调用方包根(其下 node_modules 才是 @deepseek-ai 容器)
}
