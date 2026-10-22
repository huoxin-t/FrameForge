import { FolderOpen, Loader2, Play, Settings2 } from 'lucide-react';
import {
  OUTPUT_FORMATS,
  QUALITY_PRESETS,
  getOutputFormat,
  getQualityPreset,
  type AdvancedConversionSettings,
  type OutputFormat,
  type QualityPresetId,
} from '../../shared/conversion';
import {
  getFormatCapability,
  type ConversionCapabilities,
} from '../../shared/capabilities';
import { AdvancedSettings } from './AdvancedSettings';

interface ConversionSettingsProps {
  format: OutputFormat;
  qualityPreset: QualityPresetId;
  outputDirectory: string | null;
  itemCount: number;
  starting: boolean;
  disabled: boolean;
  error: string | null;
  capabilities: ConversionCapabilities | null;
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
  audioOnlyExcludedCount: number;
  advanced: AdvancedConversionSettings;
  commandPreview: string | null;
  previewNote: string;
  onFormatChange: (format: OutputFormat) => void;
  onQualityPresetChange: (preset: QualityPresetId) => void;
  onAdvancedChange: (advanced: AdvancedConversionSettings) => void;
  onChooseDirectory: () => void;
  onRefreshCapabilities: () => void;
  onCopyCommand: (command: string) => Promise<void>;
  onStart: () => void;
}

export function ConversionSettings({
  format,
  qualityPreset,
  outputDirectory,
  itemCount,
  starting,
  disabled,
  error,
  capabilities,
  capabilitiesLoading,
  capabilitiesError,
  audioOnlyExcludedCount,
  advanced,
  commandPreview,
  previewNote,
  onFormatChange,
  onQualityPresetChange,
  onAdvancedChange,
  onChooseDirectory,
  onRefreshCapabilities,
  onCopyCommand,
  onStart,
}: ConversionSettingsProps) {
  const formatOption = getOutputFormat(format);
  const preset = getQualityPreset(qualityPreset);
  const formatCapability = capabilities
    ? getFormatCapability(capabilities, format)
    : null;
  const formatAvailable = formatCapability?.available ?? false;
  const canStart =
    Boolean(outputDirectory) &&
    itemCount > 0 &&
    !starting &&
    !disabled &&
    formatAvailable;
  const qualityLabel = formatOption.kind === 'audio' ? '音频质量' : '质量预设';

  return (
    <section
      aria-label="转换设置"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <Settings2 size={16} className="text-amber-300" aria-hidden="true" />
        <h2 className="text-sm font-medium text-white">转换设置</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="conversion-format"
            className="mb-1.5 block text-xs font-medium text-slate-300"
          >
            输出格式
          </label>
          <select
            id="conversion-format"
            aria-label="输出格式"
            value={format}
            onChange={(event) => onFormatChange(event.target.value as OutputFormat)}
            className="w-full rounded-lg border border-white/10 bg-[#141821] px-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-300/50"
          >
            {OUTPUT_FORMATS.map((option) => {
              const optionCapability = capabilities
                ? getFormatCapability(capabilities, option.id)
                : null;
              const unavailable = Boolean(
                optionCapability && !optionCapability.available,
              );
              return (
                <option key={option.id} value={option.id} disabled={unavailable}>
                  {option.label}
                  {unavailable ? '（不可用）' : ''}
                </option>
              );
            })}
          </select>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            {formatOption.container} · {formatOption.summary}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {formatOption.description}
          </p>
          {formatOption.kind === 'audio' ? (
            <p className="mt-1 text-[11px] leading-5 text-amber-200/80">
              仅导出音频，不包含视频轨道。
            </p>
          ) : null}
          {formatCapability && !formatCapability.available ? (
            <p
              role="alert"
              className="mt-1.5 rounded-md border border-rose-400/20 bg-rose-400/10 px-2 py-1.5 text-[11px] leading-5 text-rose-200"
            >
              当前 FFmpeg 缺少{' '}
              {formatCapability.missingEncoders.join('、')}，无法导出{' '}
              {formatOption.label}。
            </p>
          ) : null}
          {capabilitiesLoading ? (
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              正在检测编码器…
            </p>
          ) : null}
          {capabilitiesError ? (
            <div
              role="status"
              className="mt-1.5 rounded-md border border-rose-400/20 bg-rose-400/10 px-2 py-1.5 text-[11px] leading-5 text-rose-200"
            >
              <p>编码器检测失败：{capabilitiesError}</p>
              <button
                type="button"
                onClick={onRefreshCapabilities}
                disabled={capabilitiesLoading}
                className="mt-1 rounded border border-rose-200/30 px-2 py-1 font-medium text-rose-100 transition hover:bg-rose-200/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                重新检测编码器
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="quality-preset"
            className="mb-1.5 block text-xs font-medium text-slate-300"
          >
            {qualityLabel}
          </label>
          <select
            id="quality-preset"
            aria-label={qualityLabel}
            value={qualityPreset}
            onChange={(event) =>
              onQualityPresetChange(event.target.value as QualityPresetId)
            }
            className="w-full rounded-lg border border-white/10 bg-[#141821] px-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-300/50"
          >
            {QUALITY_PRESETS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            {formatOption.kind === 'audio'
              ? `音频 ${preset.audioBitrateKbps} kbps`
              : preset.description}
          </p>
        </div>

        <AdvancedSettings
          advanced={advanced}
          format={format}
          qualityPreset={qualityPreset}
          disabled={disabled || starting}
          commandPreview={commandPreview}
          previewNote={previewNote}
          onAdvancedChange={onAdvancedChange}
          onCopyCommand={onCopyCommand}
        />

        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-300">
            输出目录
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onChooseDirectory}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs text-slate-200 transition hover:bg-white/[0.08]"
            >
              <FolderOpen size={14} aria-hidden="true" />
              选择目录
            </button>
            <span
              className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
                outputDirectory ? 'text-slate-300' : 'text-slate-500'
              }`}
              title={outputDirectory ?? undefined}
            >
              {outputDirectory ?? '未选择输出目录'}
            </span>
          </div>
        </div>

        {audioOnlyExcludedCount > 0 ? (
          <p className="rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-[11px] leading-5 text-amber-100/80">
            已排除 {audioOnlyExcludedCount} 个无音轨视频（MP3 无法导出静音文件）。
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] leading-5 text-rose-200"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          aria-busy={starting}
          aria-keyshortcuts="Control+Enter"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {starting ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={15} aria-hidden="true" />
          )}
          {starting ? '正在启动…' : '开始转换'}
        </button>

        <p className="text-[11px] leading-5 text-slate-500">
          将转换 {itemCount} 个视频 · 串行执行，失败任务不会阻塞后续任务。
          转换期间可关闭窗口，应用会先询问是否取消任务。
        </p>
      </div>
    </section>
  );
}
