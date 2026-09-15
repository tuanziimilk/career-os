// mammoth 的浏览器构建没有随包提供类型声明，这里补一份。
//
// 为什么用 mammoth/mammoth.browser.min.js 而不是 import "mammoth"：
// 后者走的是 Node 入口（lib/index.js），它会牵进 fs 之类的 Node 内置模块。
// mammoth 的 package.json 里确实有 browser 字段做了映射，理论上打包器会
// 替换掉，但那是在赌打包器的解析行为——显式指名浏览器构建更确定，
// 代价只是这一个 .d.ts。
//
// 只声明**实际用到的**那一个函数，不照抄整个 API 面：声明得越少，
// 将来 mammoth 改了别处也不会在这儿产生假的类型安全感。
declare module "mammoth/mammoth.browser.min.js" {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface RawTextResult {
    value: string;
    messages: MammothMessage[];
  }
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<RawTextResult>;
}
