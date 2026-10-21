import { FolderOpen, Loader2 } from 'lucide-react';

interface EmptyStateProps {
  onImport: () => void;
  importing: boolean;
  disabled: boolean;
}

export function EmptyState({ onImport, importing, disabled }: EmptyStateProps) {
  return (
    <section className="flex min-h-[520px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-8 py-16 text-center">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300">
        <FolderOpen size={26} aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold text-white">还没有导入视频</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
        导入本地视频，读取时长、分辨率、帧率和编码信息，并生成缩略图。
      </p>
      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
        所有文件只在本机处理，不会上传。
      </p>

      <button
        type="button"
        onClick={onImport}
        disabled={disabled || importing}
        aria-busy={importing}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        {importing ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <FolderOpen size={16} aria-hidden="true" />
        )}
        {importing ? '正在读取媒体信息…' : '导入视频'}
      </button>

      <p className="mt-4 text-xs text-slate-500">
        支持 MP4、MOV、MKV、AVI、WebM 等常见格式，可一次选择多个文件；
        也可以把视频拖到窗口中，或按 Ctrl+O 打开选择器。
      </p>
      <div className="mt-6 rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-xs text-slate-500">
        MP4 / MKV · 本地转码 · 真实进度
      </div>
    </section>
  );
}
