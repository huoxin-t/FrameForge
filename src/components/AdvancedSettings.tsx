import { useState } from 'react';
import { Check, ChevronDown, Copy, Settings2 } from 'lucide-react';
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_MODES,
  MAX_CRF,
  MIN_CRF,
  RESOLUTION_PRESETS,
  getOutputFormat,
  getQualityPreset,
  type AdvancedConversionSettings,
  type AudioBitrateKbps,
  type AudioMode,
  type OutputFormat,
  type QualityPresetId,
  type ResolutionPresetId,
} from '../../shared/conversion';

interface AdvancedSettingsProps {
  advanced: AdvancedConversionSettings;
  format: OutputFormat;
  qualityPreset: QualityPresetId;
  disabled: boolean;
  commandPreview: string | null;
  previewNote: string;
  onAdvancedChange: (advanced: AdvancedConversionSettings) => void;
  onCopyCommand: (command: string) => Promise<void>;
}

const fieldClass =
  'w-full rounded-lg border border-white/10 bg-[#141821] px-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-60';

export function AdvancedSettings({
  advanced,
  format,
  qualityPreset,
  disabled,
  commandPreview,
  previewNote,
  onAdvancedChange,
  onCopyCommand,
}: AdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(true);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const profile = getOutputFormat(format);
  const preset = getQualityPreset(qualityPreset);
  const isVideo = profile.kind === 'video';
  const presetCrf = profile.id === 'webm' ? preset.vp9Crf : preset.crf;

  const update = (patch: Partial<AdvancedConversionSettings>) => {
    onAdvancedChange({ ...advanced, ...patch });
  };

  const handleCopy = async () => {
    if (!commandPreview) {
      return;
    }
    try {
      await onCopyCommand(commandPreview);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/10">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-slate-300 transition hover:text-white"
      >
        <span className="inline-flex items-center gap-1.5">
          <Settings2 size={13} aria-hidden="true" />
          高级设置
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          {isVideo ? (
            <>
              <div>
                <label
                  htmlFor="advanced-resolution"
                  className="mb-1.5 block text-[11px] font-medium text-slate-400"
                >
                  分辨率
                </label>
                <select
                  id="advanced-resolution"
                  aria-label="分辨率"
                  value={advanced.resolution}
                  disabled={disabled}
                  onChange={(event) =>
                    update({
                      resolution: event.target.value as ResolutionPresetId,
                    })
                  }
                  className={fieldClass}
                >
                  {RESOLUTION_PRESETS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} · {option.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="advanced-crf"
                  className="mb-1.5 block text-[11px] font-medium text-slate-400"
                >
                  CRF（{MIN_CRF}–{MAX_CRF}）
                </label>
                <select
                  id="advanced-crf"
                  aria-label="CRF"
                  value={advanced.crf === null ? '' : String(advanced.crf)}
                  disabled={disabled}
                  onChange={(event) =>
                    update({
                      crf:
                        event.target.value === ''
                          ? null
                          : Number(event.target.value),
                    })
                  }
                  className={fieldClass}
                >
                  <option value="">跟随预设（{presetCrf}）</option>
                  {Array.from(
                    { length: MAX_CRF - MIN_CRF + 1 },
                    (_, index) => MIN_CRF + index,
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] leading-5 text-slate-600">
                  CRF 越小画质越高、文件越大；留空时使用质量预设。
                </p>
              </div>

              <div>
                <label
                  htmlFor="advanced-audio-mode"
                  className="mb-1.5 block text-[11px] font-medium text-slate-400"
                >
                  音频模式
                </label>
                <select
                  id="advanced-audio-mode"
                  aria-label="音频模式"
                  value={advanced.audioMode}
                  disabled={disabled}
                  onChange={(event) =>
                    update({ audioMode: event.target.value as AudioMode })
                  }
                  className={fieldClass}
                >
                  {AUDIO_MODES.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <p className="text-[11px] leading-5 text-slate-500">
              MP3 只导出音频，因此不提供画面和视频编码设置。
            </p>
          )}

          <div>
            <label
              htmlFor="advanced-audio-bitrate"
              className="mb-1.5 block text-[11px] font-medium text-slate-400"
            >
              音频码率
            </label>
            <select
              id="advanced-audio-bitrate"
              aria-label="音频码率"
              value={
                advanced.audioBitrateKbps === null
                  ? ''
                  : String(advanced.audioBitrateKbps)
              }
              disabled={disabled}
              onChange={(event) =>
                update({
                  audioBitrateKbps:
                    event.target.value === ''
                      ? null
                      : (Number(event.target.value) as AudioBitrateKbps),
                })
              }
              className={fieldClass}
            >
              <option value="">
                跟随预设（{preset.audioBitrateKbps} kbps）
              </option>
              {AUDIO_BITRATE_OPTIONS.map((bitrate) => (
                <option key={bitrate} value={bitrate}>
                  {bitrate} kbps
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-white/10 pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setCommandOpen((current) => !current)}
                aria-expanded={commandOpen}
                className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-slate-400 transition hover:text-slate-200"
              >
                FFmpeg 命令预览
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className={`transition-transform ${commandOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!commandPreview}
                className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copyState === 'copied' ? (
                  <Check size={11} aria-hidden="true" />
                ) : (
                  <Copy size={11} aria-hidden="true" />
                )}
                复制命令
              </button>
            </div>
            {commandOpen ? (
              <>
                <pre
                  data-testid="command-preview"
                  className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px] leading-4 text-slate-400"
                >
                  {commandPreview ?? '暂无可预览命令'}
                </pre>
                <p className="mt-1 text-[10px] leading-5 text-slate-600">
                  {previewNote}
                </p>
                {copyState === 'copied' ? (
                  <p className="mt-1 text-[10px] text-emerald-300">命令已复制</p>
                ) : null}
                {copyState === 'failed' ? (
                  <p className="mt-1 text-[10px] text-rose-300">复制命令失败</p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
