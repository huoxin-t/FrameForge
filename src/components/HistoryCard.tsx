/**
 * 右侧栏转换历史卡片。
 *
 * 只展示主进程写入的终态记录；删除/清空历史不会删除真实输出文件。
 */
import { useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  RESOLUTION_PRESETS,
  getOutputFormat,
  type AdvancedConversionSettings,
} from '../../shared/conversion';
import {
  type ConversionHistoryEntry,
  type ConversionHistoryStatus,
} from '../../shared/history';
import { formatDuration } from '../../shared/media-format';
import { getFileName } from '../../shared/path';

interface HistoryCardProps {
  entries: ConversionHistoryEntry[];
  loading: boolean;
  error: string | null;
  onOpenOutput: (entry: ConversionHistoryEntry) => void;
  onOpenOutputDirectory: (entry: ConversionHistoryEntry) => void;
  onCopyError: (entry: ConversionHistoryEntry) => Promise<void>;
  onClear: () => Promise<void>;
}

type HistoryFilter = 'all' | ConversionHistoryStatus;

const FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'completed', label: '完成' },
  { id: 'failed', label: '失败' },
  { id: 'canceled', label: '取消' },
];

const STATUS_LABELS: Record<ConversionHistoryStatus, string> = {
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatEntryTime(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) {
    return '时间未知';
  }

  const date = new Date(timestamp);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function resolutionLabel(
  advanced: AdvancedConversionSettings | null,
): string | null {
  if (!advanced) {
    return null;
  }
  return (
    RESOLUTION_PRESETS.find((preset) => preset.id === advanced.resolution)
      ?.label ?? null
  );
}

function StatusIcon({ status }: { status: ConversionHistoryStatus }) {
  if (status === 'completed') {
    return <CheckCircle2 size={13} className="text-emerald-300" aria-hidden="true" />;
  }
  if (status === 'failed') {
    return <XCircle size={13} className="text-rose-300" aria-hidden="true" />;
  }
  return <Ban size={13} className="text-slate-500" aria-hidden="true" />;
}

function statusColor(status: ConversionHistoryStatus): string {
  if (status === 'completed') {
    return 'text-emerald-200';
  }
  if (status === 'failed') {
    return 'text-rose-200';
  }
  return 'text-slate-400';
}

function metaText(entry: ConversionHistoryEntry): string {
  const formatLabel = entry.format
    ? (getOutputFormat(entry.format)?.label ?? '未知格式')
    : '未知格式';
  const parts = [formatLabel];
  const resolution = resolutionLabel(entry.advanced);
  if (resolution) {
    parts.push(resolution);
  }
  if (entry.elapsedMs !== null) {
    parts.push(formatDuration(entry.elapsedMs));
  }
  parts.push(formatEntryTime(entry.finishedAt ?? entry.startedAt));
  return parts.join(' · ');
}

export function HistoryCard({
  entries,
  loading,
  error,
  onOpenOutput,
  onOpenOutputDirectory,
  onCopyError,
  onClear,
}: HistoryCardProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filtered =
    filter === 'all'
      ? entries
      : entries.filter((entry) => entry.status === filter);
  const visible = expanded ? filtered : filtered.slice(0, 5);

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClear();
      setConfirmingClear(false);
      setExpanded(false);
    } catch {
      // 失败信息由 App 的 historyError 展示，确认区保留以便重试。
    } finally {
      setClearing(false);
    }
  };

  return (
    <section
      aria-label="转换历史"
      className="rounded-xl border border-white/10 bg-[#141821]/80 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <History size={15} className="text-amber-300" aria-hidden="true" />
            <h2 className="text-sm font-medium text-white">转换历史</h2>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-400">
              {entries.length}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            完成、失败和取消都会保留；不会删除输出文件。
          </p>
        </div>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={() => setConfirmingClear((current) => !current)}
            disabled={clearing}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden="true" />
            清空
          </button>
        ) : null}
      </div>

      {confirmingClear ? (
        <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-2.5 py-2">
          <p className="text-[11px] text-rose-100">确认清空历史？</p>
          <p className="mt-0.5 text-[10px] leading-4 text-rose-200/70">
            只删除记录，不删除已转换的文件。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={clearing}
              className="rounded bg-rose-300 px-2 py-1 text-[10px] font-medium text-slate-950 transition hover:bg-rose-200 disabled:opacity-50"
            >
              {clearing ? '清空中…' : '确认清空'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              disabled={clearing}
              className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              保留
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="历史筛选">
        {FILTERS.map((option) => {
          const active = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option.id)}
              className={`rounded px-2 py-1 text-[10px] transition ${
                active
                  ? 'bg-amber-300/15 text-amber-200'
                  : 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-2 rounded border border-rose-400/20 bg-rose-400/10 px-2 py-1.5 text-[10px] leading-4 text-rose-200"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-1.5 py-4 text-[11px] text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          正在读取历史…
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-[11px] leading-5 text-slate-600">
          {entries.length === 0
            ? '完成一次转换后，记录会出现在这里。'
            : '没有符合条件的记录。'}
        </p>
      ) : (
        <div
          className={`space-y-2 ${
            expanded ? 'max-h-[360px] overflow-y-auto pr-1' : ''
          }`}
        >
          {visible.map((entry) => {
            const title = entry.outputPath
              ? getFileName(entry.outputPath)
              : entry.fileName;
            return (
              <article
                key={entry.id}
                className="rounded-lg border border-white/5 bg-black/15 px-2.5 py-2"
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={entry.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="truncate text-[11px] font-medium text-slate-200"
                        title={entry.outputPath || entry.fileName}
                      >
                        {title}
                      </p>
                      <span
                        className={`shrink-0 text-[10px] ${statusColor(entry.status)}`}
                      >
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">
                      {metaText(entry)}
                    </p>
                    {entry.status === 'completed' && !entry.outputExists ? (
                      <p className="mt-1 text-[10px] text-amber-200/80">
                        输出文件不存在
                      </p>
                    ) : null}
                    {entry.status === 'failed' && entry.error ? (
                      <p
                        className="mt-1 line-clamp-2 text-[10px] leading-4 text-rose-200/80"
                        title={entry.error}
                      >
                        {entry.error}
                      </p>
                    ) : null}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {entry.status === 'completed' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenOutput(entry)}
                            disabled={!entry.outputExists}
                            className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ExternalLink size={10} aria-hidden="true" />
                            打开文件
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenOutputDirectory(entry)}
                            disabled={!entry.outputExists}
                            className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <FolderOpen size={10} aria-hidden="true" />
                            打开文件夹
                          </button>
                        </>
                      ) : null}
                      {entry.status === 'failed' ? (
                        <button
                          type="button"
                          onClick={() => void onCopyError(entry)}
                          className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 transition hover:bg-white/[0.07]"
                        >
                          <Copy size={10} aria-hidden="true" />
                          复制错误
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded border border-white/5 py-1 text-[10px] text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300"
        >
          {expanded ? (
            <>
              <ChevronUp size={11} aria-hidden="true" />
              收起
            </>
          ) : (
            <>
              <ChevronDown size={11} aria-hidden="true" />
              展开全部 {filtered.length} 条
            </>
          )}
        </button>
      ) : null}
    </section>
  );
}
