import { Cpu, Film, FolderOpen } from 'lucide-react';
import type { FfmpegSource } from '../../shared/media';
import type { AppInfoState, FfmpegState } from '../types/ui';

interface EnvironmentPanelProps {
  state: AppInfoState;
  ffmpeg: FfmpegState;
  onOpenLogDirectory: () => void;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-xs text-slate-300">{value}</dd>
    </div>
  );
}

function sourceLabel(source: FfmpegSource | null): string {
  switch (source) {
    case 'environment':
      return '环境变量指定';
    case 'bundled':
      return '随包目录';
    case 'system':
      return '系统 PATH';
    default:
      return '未知';
  }
}

export function EnvironmentPanel({
  state,
  ffmpeg,
  onOpenLogDirectory,
}: EnvironmentPanelProps) {
  return (
    <aside className="self-start rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Cpu size={16} className="text-slate-400" aria-hidden="true" />
        <h2 className="text-sm font-medium text-white">运行环境</h2>
      </div>

      {state.status === 'loading' ? (
        <p className="text-xs text-slate-500">正在读取应用信息…</p>
      ) : null}

      {state.status === 'error' ? (
        <p className="text-xs leading-5 text-rose-300">应用信息读取失败：{state.message}</p>
      ) : null}

      {state.status === 'ready' ? (
        <dl>
          <InfoRow label="应用版本" value={state.info.version} />
          <InfoRow label="Electron" value={state.info.electronVersion} />
          <InfoRow label="Chromium" value={state.info.chromeVersion} />
          <InfoRow label="Node.js" value={state.info.nodeVersion} />
          <InfoRow label="平台" value={`${state.info.platform} · ${state.info.arch}`} />
        </dl>
      ) : null}

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Film size={15} className="text-slate-400" aria-hidden="true" />
          <h3 className="text-xs font-medium text-slate-200">FFmpeg 环境</h3>
        </div>

        {ffmpeg.status === 'loading' ? (
          <p className="text-xs text-slate-500">正在检测 ffmpeg / ffprobe…</p>
        ) : null}

        {ffmpeg.status === 'error' ? (
          <div className="space-y-2">
            <p className="text-xs leading-5 text-rose-300">FFmpeg 未就绪：{ffmpeg.message}</p>
            <p className="text-[11px] leading-5 text-slate-500">
              安装 FFmpeg 并加入 PATH，或把 ffmpeg.exe / ffprobe.exe 放入
              resources/ffmpeg 后重启应用。
            </p>
          </div>
        ) : null}

        {ffmpeg.status === 'ready' ? (
          <dl>
            <InfoRow label="FFmpeg" value={ffmpeg.info.version ?? '未知'} />
            <InfoRow label="FFprobe" value={ffmpeg.info.ffprobeVersion ?? '未知'} />
            <InfoRow label="来源" value={sourceLabel(ffmpeg.info.source)} />
            <InfoRow label="FFmpeg 路径" value={ffmpeg.info.ffmpegPath ?? '未知'} />
          </dl>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenLogDirectory}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
      >
        <FolderOpen size={14} aria-hidden="true" />
        打开日志目录
      </button>

      <p className="mt-4 border-t border-white/5 pt-4 text-[11px] leading-5 text-slate-500">
        渲染进程不直接访问 Node.js。媒体信息与缩略图由主进程通过受控 IPC 读取。
      </p>
    </aside>
  );
}
