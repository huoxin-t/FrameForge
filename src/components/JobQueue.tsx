import { useState } from 'react';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { ConversionJob, ConversionJobStatus } from '../../shared/conversion';
import { formatDuration } from '../../shared/media-format';

interface JobQueueProps {
  jobs: ConversionJob[];
  onCancel: (jobId: string) => void;
  onOpenOutput: (jobId: string) => void;
  onOpenOutputDirectory: (jobId: string) => void;
  onCopyError: (job: ConversionJob) => Promise<void>;
  onOpenLogDirectory: () => void;
  onRemoveJob: (jobId: string) => void;
  onClearFinished: () => void;
}

const STATUS_LABELS: Record<ConversionJobStatus, string> = {
  queued: '排队中',
  running: '转换中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};

function StatusIcon({ status }: { status: ConversionJobStatus }) {
  if (status === 'running') {
    return <Loader2 size={14} className="animate-spin" aria-hidden="true" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 size={14} aria-hidden="true" />;
  }
  if (status === 'failed') {
    return <XCircle size={14} aria-hidden="true" />;
  }
  if (status === 'canceled') {
    return <Ban size={14} aria-hidden="true" />;
  }
  return <CircleDashed size={14} aria-hidden="true" />;
}

function statusClass(status: ConversionJobStatus): string {
  if (status === 'completed') {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  }
  if (status === 'failed') {
    return 'border-rose-400/20 bg-rose-400/10 text-rose-300';
  }
  if (status === 'canceled') {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
  }
  if (status === 'running') {
    return 'border-sky-400/20 bg-sky-400/10 text-sky-300';
  }
  return 'border-white/10 bg-white/[0.04] text-slate-400';
}

function actionClass(): string {
  return 'inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 transition hover:bg-white/[0.09] hover:text-white';
}

export function JobQueue({
  jobs,
  onCancel,
  onOpenOutput,
  onOpenOutputDirectory,
  onCopyError,
  onOpenLogDirectory,
  onRemoveJob,
  onClearFinished,
}: JobQueueProps) {
  const [copyFeedback, setCopyFeedback] = useState<{
    jobId: string;
    copied: boolean;
  } | null>(null);

  const completedCount = jobs.filter((job) => job.status === 'completed').length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;
  const activeCount = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running',
  ).length;
  const finishedCount = jobs.length - activeCount;

  const handleCopyError = async (job: ConversionJob) => {
    try {
      await onCopyError(job);
      setCopyFeedback({ jobId: job.id, copied: true });
    } catch {
      setCopyFeedback({ jobId: job.id, copied: false });
    }
  };

  return (
    <section
      aria-label="任务队列"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">任务队列</h2>
          {jobs.length > 0 ? (
            <p className="mt-1 text-[11px] text-slate-500" aria-live="polite">
              完成 {completedCount} / {jobs.length}
              {failedCount > 0 ? ` · 失败 ${failedCount}` : ''}
              {activeCount > 0 ? ` · 进行中 ${activeCount}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {finishedCount > 0 ? (
            <button
              type="button"
              onClick={onClearFinished}
              title="清空已完成、失败和已取消任务，不会删除输出文件"
              className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200"
            >
              <Trash2 size={11} aria-hidden="true" />
              清空
            </button>
          ) : null}
          <span className="text-[11px] text-slate-500">
            {jobs.length} 个任务
          </span>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-xs leading-5 text-slate-500">
          开始转换后，任务状态和真实进度会显示在这里。
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const progress = Math.max(0, Math.min(100, job.progress));
            const canCancel = job.status === 'queued' || job.status === 'running';

            return (
              <article
                key={job.id}
                className="rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3
                      className="truncate text-xs font-medium text-slate-200"
                      title={job.sourcePath}
                    >
                      {job.fileName}
                    </h3>
                    <p
                      className="mt-1 truncate font-mono text-[10px] text-slate-600"
                      title={job.outputPath || undefined}
                    >
                      {job.outputPath || '未生成输出路径'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${statusClass(
                        job.status,
                      )}`}
                    >
                      <StatusIcon status={job.status} />
                      {STATUS_LABELS[job.status]}
                    </span>
                    {!canCancel ? (
                      <button
                        type="button"
                        onClick={() => onRemoveJob(job.id)}
                        aria-label={`从任务队列删除 ${job.fileName}`}
                        title="从队列删除（不会删除输出文件）"
                        className="inline-flex size-5 items-center justify-center rounded border border-transparent text-slate-500 transition hover:border-rose-400/20 hover:bg-rose-400/10 hover:text-rose-300 focus-visible:border-rose-400/40 focus-visible:outline-none"
                      >
                        <Trash2 size={11} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"
                    role="progressbar"
                    aria-label={`${job.fileName} 转换进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        job.status === 'failed'
                          ? 'bg-rose-400'
                          : job.status === 'canceled'
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right font-mono text-[10px] text-slate-400">
                    {progress}%
                  </span>
                </div>

                {job.status === 'running' ? (
                  <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                    已用 {formatDuration(job.elapsedMs)} ·{' '}
                    {job.etaSeconds === null
                      ? '剩余估算中'
                      : `剩余约 ${formatDuration(job.etaSeconds * 1000)}`}{' '}
                    ·{' '}
                    {job.speed === null
                      ? '速度估算中'
                      : `${job.speed.toFixed(2)}×`}
                  </p>
                ) : null}

                {job.error ? (
                  <p className="mt-2 text-[11px] leading-5 text-rose-300">
                    {job.error}
                  </p>
                ) : null}

                {job.logExcerpt ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                      查看详细日志
                    </summary>
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] leading-4 text-slate-500">
                      {job.logExcerpt}
                    </pre>
                  </details>
                ) : null}

                {job.status === 'completed' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenOutput(job.id)}
                      className={actionClass()}
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                      打开文件
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenOutputDirectory(job.id)}
                      className={actionClass()}
                    >
                      <FolderOpen size={12} aria-hidden="true" />
                      打开所在目录
                    </button>
                  </div>
                ) : null}

                {job.status === 'failed' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyError(job)}
                      className={actionClass()}
                    >
                      <Copy size={12} aria-hidden="true" />
                      复制错误
                    </button>
                    <button
                      type="button"
                      onClick={onOpenLogDirectory}
                      className={actionClass()}
                    >
                      <FolderOpen size={12} aria-hidden="true" />
                      打开日志目录
                    </button>
                    {copyFeedback?.jobId === job.id ? (
                      <span
                        className={`text-[10px] ${
                          copyFeedback.copied
                            ? 'text-emerald-300'
                            : 'text-rose-300'
                        }`}
                      >
                        {copyFeedback.copied ? '已复制' : '复制失败'}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel(job.id)}
                    className="mt-2 text-[11px] text-amber-300 hover:text-amber-200"
                  >
                    取消
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
