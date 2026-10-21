import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react';

interface FfmpegErrorBannerProps {
  message: string;
  onRetry: () => void;
  onOpenLogDirectory: () => void;
}

/**
 * FFmpeg 缺失/损坏时的阻塞式提示。
 *
 * 只展示用户能采取的动作：重新检测、打开日志目录、重新安装。
 * 不展示开发者路径、环境变量或内部资源目录。
 */
export function FfmpegErrorBanner({
  message,
  onRetry,
  onOpenLogDirectory,
}: FfmpegErrorBannerProps) {
  return (
    <section
      role="alert"
      className="mb-4 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-4 text-rose-100"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={18}
          className="mt-0.5 shrink-0 text-rose-300"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-rose-100">视频引擎未就绪</h2>
          <p className="mt-1 text-xs leading-5 text-rose-200/90">{message}</p>
          <p className="mt-1 text-[11px] leading-5 text-rose-200/60">
            随安装包提供的 FFmpeg 缺失或无法启动。请先重新检测；如果仍然失败，请打开日志目录查看详细信息。
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-300/20"
            >
              <RefreshCw size={13} aria-hidden="true" />
              重新检测
            </button>
            <button
              type="button"
              onClick={onOpenLogDirectory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-rose-100/90 transition hover:bg-white/[0.08]"
            >
              <FolderOpen size={13} aria-hidden="true" />
              打开日志目录
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
