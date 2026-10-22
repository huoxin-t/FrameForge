import { Loader2, Plus } from 'lucide-react';
import type { MediaItem } from '../../shared/media';
import { MediaCard } from './MediaCard';

interface MediaListProps {
  items: MediaItem[];
  onImport: () => void;
  onRemove: (item: MediaItem) => void;
  activeSourcePaths: ReadonlySet<string>;
  importing: boolean;
  disabled: boolean;
}

export function MediaList({
  items,
  onImport,
  onRemove,
  activeSourcePaths,
  importing,
  disabled,
}: MediaListProps) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">视频工作台</h1>
          <p className="mt-1 text-xs text-slate-500">
            已导入 {items.length} 个视频 · 拖入更多文件可继续添加
          </p>
        </div>
        <button
          type="button"
          onClick={onImport}
          disabled={disabled || importing}
          aria-busy={importing}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        >
          {importing ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus size={15} aria-hidden="true" />
          )}
          {importing ? '正在读取媒体信息…' : '添加视频'}
        </button>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <MediaCard
            key={item.path}
            item={item}
            onRemove={onRemove}
            removeDisabled={activeSourcePaths.has(item.path.toLowerCase())}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-slate-600">
        在右侧选择输出目录和预设后开始转换；Ctrl+Enter 可直接开始。
        缩略图失败不会阻止转换。
      </p>
    </section>
  );
}
