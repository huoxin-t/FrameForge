import type { ReactNode } from 'react';
import { Film, FolderOpen, ShieldCheck } from 'lucide-react';
import type { FfmpegState } from '../types/ui';

interface AppShellProps {
  version?: string;
  ffmpeg: FfmpegState;
  onOpenLogDirectory: () => void;
  children: ReactNode;
}

function FfmpegBadge({ state }: { state: FfmpegState }) {
  if (state.status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-400">
        <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
        FFmpeg 检测中
      </span>
    );
  }

  if (state.status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-rose-300"
        title={state.message}
      >
        <span className="size-1.5 rounded-full bg-rose-400" />
        FFmpeg 未就绪
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-emerald-300"
      title={`${state.info.version ?? '未知版本'} · ${state.info.ffmpegPath ?? ''}`}
    >
      <span className="size-1.5 rounded-full bg-emerald-400" />
      FFmpeg 已就绪
    </span>
  );
}

export function AppShell({
  version,
  ffmpeg,
  onOpenLogDirectory,
  children,
}: AppShellProps) {
  return (
    <div className="relative isolate flex h-screen flex-col overflow-hidden bg-[#0b0d12] text-slate-200">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_-10%,rgba(251,191,36,0.10),transparent_38%),radial-gradient(circle_at_92%_108%,rgba(56,189,248,0.06),transparent_42%)]"
      />
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0d12]/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg border border-amber-300/20 bg-amber-400/10 text-amber-300">
            <Film size={19} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight text-white">FrameForge</span>
              <span className="text-xs text-slate-400">帧铸</span>
            </div>
            <p className="text-[11px] text-slate-500">本地视频格式转换工作台</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-400" aria-hidden="true" />
            本地处理 · 文件不会上传
          </span>
          <FfmpegBadge state={ffmpeg} />
          {version ? (
            <span className="rounded border border-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300">
              v{version}
            </span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-white/10 px-6 py-2 text-[11px] text-slate-500">
        <span>本地转换 · 输出文件验证后才算完成</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenLogDirectory}
            className="inline-flex items-center gap-1 text-slate-500 transition hover:text-slate-300"
          >
            <FolderOpen size={12} aria-hidden="true" />
            打开日志目录
          </button>
          <span className="hidden font-mono sm:inline">Ctrl+O 导入 · Ctrl+Enter 开始</span>
        </div>
      </footer>
    </div>
  );
}
