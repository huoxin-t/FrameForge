import { Film } from 'lucide-react';
import type { MediaItem } from '../../shared/media';
import {
  formatDuration,
  formatFileSize,
  formatFrameRate,
  formatResolution,
} from '../../shared/media-format';

interface MediaCardProps {
  item: MediaItem;
}

export function MediaCard({ item }: MediaCardProps) {
  const metadata = item.metadata;

  return (
    <article className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="relative aspect-video w-44 shrink-0 overflow-hidden rounded-lg border border-white/5 bg-black/40">
        {item.thumbnailDataUrl ? (
          <img
            src={item.thumbnailDataUrl}
            alt={`${item.fileName} 缩略图`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-600">
            <Film size={22} aria-hidden="true" />
            <span className="text-[11px]">暂无缩略图</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-slate-100" title={item.path}>
              {item.fileName}
            </h2>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-600" title={item.path}>
              {item.path}
            </p>
          </div>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
              item.error
                ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
                : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
            }`}
          >
            {item.error ? '读取失败' : '已读取'}
          </span>
        </div>

        {item.error ? (
          <p className="mt-3 text-xs leading-5 text-rose-300">{item.error}</p>
        ) : null}

        {metadata ? (
          <>
            <p className="mt-2 text-xs text-slate-400">
              {formatDuration(metadata.durationMs)}
              <span className="px-1.5 text-slate-600">·</span>
              {formatResolution(metadata.width, metadata.height)}
              <span className="px-1.5 text-slate-600">·</span>
              {formatFrameRate(metadata.frameRate)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {metadata.containerFormat ?? '未知'}
              <span className="px-1.5 text-slate-600">·</span>
              {metadata.videoCodec ?? '未知'}
              <span className="px-1.5 text-slate-600">·</span>
              {metadata.audioCodec ?? '无音轨'}
              <span className="px-1.5 text-slate-600">·</span>
              {formatFileSize(metadata.fileSizeBytes)}
            </p>
          </>
        ) : null}

        {item.thumbnailError ? (
          <p className="mt-2 text-[11px] leading-5 text-amber-300/80">
            缩略图不可用：{item.thumbnailError}
          </p>
        ) : null}
      </div>
    </article>
  );
}
