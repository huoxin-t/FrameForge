/**
 * 转换历史持久化。
 *
 * 主进程独占历史文件；renderer 只拿到展示 DTO。写入使用临时文件 + rename，
 * 损坏文件会备份后回退为空历史，避免一次坏 JSON 让应用无法启动。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AdvancedConversionSettings,
  ConversionJob,
  ConversionSettings,
} from '../../../../shared/conversion';
import {
  isAudioBitrateKbps,
  isAudioMode,
  isCrfInRange,
  isOutputFormat,
  isQualityPresetId,
  isResolutionPresetId,
} from '../../../../shared/conversion';
import {
  MAX_CONVERSION_HISTORY_ENTRIES,
  isConversionHistoryStatus,
  mergeHistoryEntries,
  type ConversionHistoryEntry,
  type ConversionHistoryStatus,
} from '../../../../shared/history';
import { createLogger } from '../logger';
import { pathExists as defaultPathExists } from '../system/path-exists';

const logger = createLogger('conversion-history');

const HISTORY_VERSION = 1;
const MAX_ERROR_LENGTH = 2_000;
const MAX_LOG_LENGTH = 4_000;

type StoredHistoryEntry = Omit<ConversionHistoryEntry, 'outputExists'>;

interface HistoryFile {
  version: number;
  entries: StoredHistoryEntry[];
}

export interface ConversionHistoryStoreOptions {
  filePath: string;
  maxEntries?: number;
  now?: () => number;
  generateId?: () => string;
  pathExists?: (path: string) => Promise<boolean>;
}

export class HistoryStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryStoreError';
  }
}

export function parseHistoryId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new HistoryStoreError('历史记录 ID 无效');
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAdvanced(value: unknown): AdvancedConversionSettings | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isResolutionPresetId(value.resolution) ||
    !(
      value.audioBitrateKbps === null ||
      isAudioBitrateKbps(value.audioBitrateKbps)
    ) ||
    !(
      value.crf === null ||
      (typeof value.crf === 'number' && isCrfInRange(value.crf))
    ) ||
    !isAudioMode(value.audioMode)
  ) {
    return null;
  }

  return {
    resolution: value.resolution,
    audioBitrateKbps: value.audioBitrateKbps,
    crf: value.crf,
    audioMode: value.audioMode,
  };
}

function parseTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function parseStoredEntry(value: unknown): StoredHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = value.status;
  if (!isConversionHistoryStatus(status)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.sourcePath !== 'string' ||
    typeof value.fileName !== 'string' ||
    typeof value.outputPath !== 'string'
  ) {
    return null;
  }

  const format = value.format;
  if (!(format === null || isOutputFormat(format))) {
    return null;
  }
  const qualityPreset = value.qualityPreset;
  if (!(qualityPreset === null || isQualityPresetId(qualityPreset))) {
    return null;
  }
  const advanced = parseAdvanced(value.advanced ?? null);
  if (value.advanced !== null && value.advanced !== undefined && !advanced) {
    return null;
  }

  return {
    id: value.id,
    sourcePath: value.sourcePath,
    fileName: value.fileName,
    outputPath: value.outputPath,
    format,
    qualityPreset,
    advanced,
    status,
    startedAt: parseTimestamp(value.startedAt),
    finishedAt: parseTimestamp(value.finishedAt),
    elapsedMs: parseTimestamp(value.elapsedMs),
    error: parseText(value.error, MAX_ERROR_LENGTH),
    logExcerpt: parseText(value.logExcerpt, MAX_LOG_LENGTH),
  };
}

function terminalStatus(job: ConversionJob): ConversionHistoryStatus | null {
  return isConversionHistoryStatus(job.status) ? job.status : null;
}

function nowDefault(): number {
  return Date.now();
}

function idDefault(): string {
  return `history-${randomUUID()}`;
}

export class ConversionHistoryStore {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly pathExists: (path: string) => Promise<boolean>;
  private readonly recordedJobIds = new Set<string>();
  private entries: StoredHistoryEntry[] | null = null;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(options: ConversionHistoryStoreOptions) {
    if (!options.filePath.trim()) {
      throw new HistoryStoreError('历史文件路径不能为空');
    }

    this.filePath = options.filePath;
    this.maxEntries = Math.max(
      0,
      Math.min(
        MAX_CONVERSION_HISTORY_ENTRIES,
        options.maxEntries ?? MAX_CONVERSION_HISTORY_ENTRIES,
      ),
    );
    this.now = options.now ?? nowDefault;
    this.generateId = options.generateId ?? idDefault;
    this.pathExists = options.pathExists ?? defaultPathExists;
  }

  async list(): Promise<ConversionHistoryEntry[]> {
    await this.ensureLoaded();
    await this.mutationQueue;

    const entries = this.entries ?? [];
    return Promise.all(entries.map((entry) => this.toView(entry)));
  }

  async get(historyId: string): Promise<ConversionHistoryEntry | null> {
    await this.ensureLoaded();
    await this.mutationQueue;

    const entry = (this.entries ?? []).find((item) => item.id === historyId);
    return entry ? this.toView(entry) : null;
  }

  async record(
    job: ConversionJob,
    settings: ConversionSettings | null,
  ): Promise<ConversionHistoryEntry | null> {
    const status = terminalStatus(job);
    if (!status) {
      return null;
    }

    return this.runMutation(async () => {
      await this.ensureLoaded();
      if (this.recordedJobIds.has(job.id)) {
        return null;
      }

      const finishedAt = job.finishedAt ?? this.now();
      const entry: StoredHistoryEntry = {
        id: this.generateId(),
        sourcePath: job.sourcePath,
        fileName: job.fileName,
        outputPath: job.outputPath,
        format: settings?.format ?? null,
        qualityPreset: settings?.qualityPreset ?? null,
        advanced: settings ? { ...settings.advanced } : null,
        status,
        startedAt: job.startedAt,
        finishedAt,
        elapsedMs:
          job.elapsedMs ??
          (job.startedAt === null
            ? null
            : Math.max(0, finishedAt - job.startedAt)),
        error: parseText(job.error, MAX_ERROR_LENGTH),
        logExcerpt: parseText(job.logExcerpt, MAX_LOG_LENGTH),
      };

      const previous = this.entries ?? [];
      const next = mergeHistoryEntries(
        previous.map((item) => ({ ...item, outputExists: false })),
        { ...entry, outputExists: false },
        this.maxEntries,
      ).map(({ outputExists: _outputExists, ...item }) => item);

      this.entries = next;
      try {
        await this.persist(next);
      } catch (error) {
        this.entries = previous;
        logger.error('Failed to persist conversion history', {
          filePath: this.filePath,
          error,
        });
        throw error;
      }

      this.recordedJobIds.add(job.id);
      return this.toView(entry);
    });
  }

  async clear(): Promise<void> {
    await this.runMutation(async () => {
      await this.ensureLoaded();
      const previous = this.entries ?? [];
      this.entries = [];
      try {
        await this.persist([]);
      } catch (error) {
        this.entries = previous;
        logger.error('Failed to clear conversion history', {
          filePath: this.filePath,
          error,
        });
        throw error;
      }
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.entries) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk();
    }
    await this.loadPromise;
  }

  private async loadFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.entries = [];
        return;
      }
      logger.error('Failed to read conversion history', {
        filePath: this.filePath,
        error,
      });
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      const rawEntries = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.entries)
          ? parsed.entries
          : null;

      if (!rawEntries) {
        throw new Error('历史文件结构无效');
      }

      const entries = rawEntries
        .map(parseStoredEntry)
        .filter((entry): entry is StoredHistoryEntry => entry !== null)
        .sort(
          (left, right) =>
            (right.finishedAt ?? right.startedAt ?? 0) -
            (left.finishedAt ?? left.startedAt ?? 0),
        )
        .slice(0, this.maxEntries);

      this.entries = entries;
    } catch (error) {
      logger.warn('Conversion history file is corrupt; starting empty', {
        filePath: this.filePath,
        error,
      });
      await this.backupCorruptFile();
      this.entries = [];
    }
  }

  private async backupCorruptFile(): Promise<void> {
    const backupPath = `${this.filePath}.corrupt-${this.now()}`;
    try {
      await rename(this.filePath, backupPath);
      logger.warn('Corrupt conversion history backed up', { backupPath });
    } catch (error) {
      logger.error('Failed to back up corrupt conversion history', {
        filePath: this.filePath,
        backupPath,
        error,
      });
    }
  }

  private async toView(entry: StoredHistoryEntry): Promise<ConversionHistoryEntry> {
    const outputExists =
      entry.status === 'completed' && Boolean(entry.outputPath)
        ? await this.pathExists(entry.outputPath)
        : false;

    return { ...entry, outputExists };
  }

  private async persist(entries: StoredHistoryEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const payload: HistoryFile = {
      version: HISTORY_VERSION,
      entries,
    };
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;

    await writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private runMutation<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(task, task);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createConversionHistoryStore(
  options: ConversionHistoryStoreOptions,
): ConversionHistoryStore {
  return new ConversionHistoryStore(options);
}
