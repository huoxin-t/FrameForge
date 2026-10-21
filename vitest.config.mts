import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'shared'),
      '@renderer': resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    // verbose 会保留每个用例的 stdout，方便看到测试内部的 START / STEP / PASS 日志。
    reporters: ['verbose'],
    // 测试文件串行执行，避免多个文件的日志交错，便于按 START/STEP/PASS 顺序阅读。
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    // 约定：一个开发阶段一个测试文件，例如 phase-01-skeleton.test.tsx。
    include: ['test/phase-*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
  },
});
