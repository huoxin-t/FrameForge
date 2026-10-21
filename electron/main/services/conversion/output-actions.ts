/**
 * 已完成任务的输出操作。
 *
 * renderer 只能传任务 id，由主进程从队列中取出真实输出路径；这里再次
 * 校验任务状态和文件存在性，避免把任意路径打开能力暴露给页面。
 */
import type { ConversionJob } from '../../../../shared/conversion';

export interface OutputActionDependencies {
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
  pathExists: (path: string) => Promise<boolean>;
}

export class OutputActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputActionError';
  }
}

function getCompletedOutputPath(job: ConversionJob | null): string {
  if (!job || job.status !== 'completed' || !job.outputPath.trim()) {
    throw new OutputActionError('任务尚未成功完成，无法打开输出文件');
  }
  return job.outputPath;
}

async function assertOutputExists(
  job: ConversionJob | null,
  dependencies: OutputActionDependencies,
): Promise<string> {
  const outputPath = getCompletedOutputPath(job);
  if (!(await dependencies.pathExists(outputPath))) {
    throw new OutputActionError('输出文件已不存在，可能已被移动或删除');
  }
  return outputPath;
}

export async function openCompletedOutput(
  job: ConversionJob | null,
  dependencies: OutputActionDependencies,
): Promise<void> {
  const outputPath = await assertOutputExists(job, dependencies);
  const error = await dependencies.openPath(outputPath);
  if (error) {
    throw new OutputActionError(`无法打开输出文件：${error}`);
  }
}

export async function revealCompletedOutput(
  job: ConversionJob | null,
  dependencies: OutputActionDependencies,
): Promise<void> {
  const outputPath = await assertOutputExists(job, dependencies);
  dependencies.showItemInFolder(outputPath);
}
