/**
 * 测试用的能力矩阵。
 *
 * 这里使用 shared/capabilities 的真实构造函数，避免测试手写一份
 * 与生产逻辑不一致的 formats 列表。编码器是否齐全由测试显式指定。
 */
import {
  ALL_ENCODERS_AVAILABLE,
  buildConversionCapabilities,
  type EncoderAvailability,
} from '../../shared/capabilities';

export const readyCapabilities = buildConversionCapabilities(
  ALL_ENCODERS_AVAILABLE,
  {
    checkedAt: 0,
    ffmpegVersion: '8.0.1',
  },
);

export function capabilitiesWithout(
  overrides: Partial<EncoderAvailability>,
): ReturnType<typeof buildConversionCapabilities> {
  return buildConversionCapabilities(
    { ...ALL_ENCODERS_AVAILABLE, ...overrides },
    {
      checkedAt: 0,
      ffmpegVersion: '8.0.1',
    },
  );
}
