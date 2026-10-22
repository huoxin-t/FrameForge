/**
 * 转换历史共享模型。
 *
 * 历史只记录已经结束的任务；队列中的 queued/running 不属于历史。
 */
import type {
  AdvancedConversionSettings,
  ConversionJobStatus,
  OutputFormat,
  QualityPresetId,
} from './conversion';

export const MAX_CONVERSION_HISTORY_ENTRIES = 200;

export type ConversionHistoryStatus = Extract<
  ConversionJobStatus,
  'completed' | 'failed' | 'canceled'
>;

export interface ConversionHistoryEntry {
  id: string;
  sourcePath: string;
  fileName: string;
  outputPath: string;
  format: OutputFormat | null;
  qualityPreset: QualityPresetId | null;
  advanced: AdvancedConversionSettings | null;
  status: ConversionHistoryStatus;
  startedAt: number | null;
  finishedAt: number | null;
  elapsedMs: number | null;
  error: string | null;
  logExcerpt: string | null;
  /** 读取历史时由主进程检查；不持久化为真实状态。 */
  outputExists: boolean;
}

export function isConversionHistoryStatus(
  value: unknown,
): value is ConversionHistoryStatus {
  return value === 'completed' || value === 'failed' || value === 'canceled';
}

function historyTime(entry: ConversionHistoryEntry): number {
  return entry.finishedAt ?? entry.startedAt ?? 0;
}

/**
 * 将一条新历史并入列表：按结束时间倒序、按 id 去重并限制上限。
 * 主进程和 renderer 共用这一规则，避免两边排序结果不一致。
 */
export function mergeHistoryEntries(
  current: ConversionHistoryEntry[],
  incoming: ConversionHistoryEntry,
  maxEntries = MAX_CONVERSION_HISTORY_ENTRIES,
): ConversionHistoryEntry[] {
  const merged = [
    incoming,
    ...current.filter((entry) => entry.id !== incoming.id),
  ].sort((left, right) => historyTime(right) - historyTime(left));

  return merged.slice(0, Math.max(0, maxEntries));
}
