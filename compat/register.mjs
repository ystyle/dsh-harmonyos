// module.register() 引导: node >= 20.6 的 hooks 注册方式, 替代弃用的 --experimental-loader。
// 由 dsh-ohos 以 --import 方式在应用代码之前加载, 把 compat-loader 的 resolve 钩子挂进全局。
import { register } from 'node:module';
register('./compat-loader.mjs', import.meta.url);
