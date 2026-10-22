/**
 * 主进程参数入口。
 *
 * 真正实现位于 shared/conversion-args.ts，便于 renderer 使用同一份纯函数
 * 生成只读命令预览；主进程仍通过这里构造实际执行的参数。
 */
export {
  buildConversionArgs,
  formatCommandForDisplay,
  getFormatExtension,
  ConversionArgsError,
} from '../../../../shared/conversion-args';
export type { BuildConversionArgsOptions } from '../../../../shared/conversion-args';
