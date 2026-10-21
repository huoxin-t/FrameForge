/**
 * Vitest 全局测试钩子。
 *
 * 每个测试都会自动产生三条日志：
 * - START：测试开始，打印用例名称。
 * - PASS / FAIL / SKIP：测试结束，打印结果和耗时；失败时附带错误对象。
 *
 * 这样即使某个测试中途卡住，也能从日志判断最后执行到哪个用例。
 * 具体测试内部的 STEP 日志由各测试文件按需补充。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { createTestLogger } from './helpers/test-logger';

const logger = createTestLogger('lifecycle');

beforeEach((context) => {
  const startedAt = Date.now();
  logger.info(`START ${context.task.name}`);

  // onTestFinished 在 afterEach 之后执行，此时 task.result 已经是最终状态。
  context.onTestFinished((finishedContext) => {
    const result = finishedContext.task.result;
    const state = result?.state ?? 'unknown';

    if (state === 'pass') {
      logger.info(`PASS ${context.task.name}`, { durationMs: Date.now() - startedAt });
      return;
    }

    if (state === 'skip') {
      logger.warn(`SKIP ${context.task.name}`);
      return;
    }

    logger.error(`FAIL ${context.task.name}`, {
      state,
      errors: result?.errors,
    });
  });
});

afterEach(() => {
  // 清理 React Testing Library 挂载的 DOM，避免用例之间互相影响。
  cleanup();
});
