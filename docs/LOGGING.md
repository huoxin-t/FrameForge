# FrameForge 日志与主函数编排规范

> 本规范适用于 Electron 主进程、preload、测试、开发脚本和未来可能出现的 Python 辅助脚本。
> 目标：任何一次失败都能从日志定位到“哪个阶段、哪个函数、什么输入、什么错误”，而不是靠重新运行猜。

## 1. 主函数编排

### 1.1 应用入口

`electron/main/index.ts` 只保留一个启动入口：

```ts
async function main(): Promise<void> {
  await initLogger();
  await resolveFfmpeg();
  registerIpcHandlers();
  await createMainWindow();
  registerAppLifecycle();
}
```

规则：

- `main()` 只负责顺序、依赖组装、顶层错误处理和退出码。
- 具体工作拆成子函数，每个子函数只做一件事。
- 子函数失败时抛出带上下文的错误，由 `main()` 统一 `logger.error`。
- 不在 `main()` 里写 FFmpeg 参数、文件解析、窗口 UI 细节。

### 1.2 服务模块

每个服务模块导出的公开函数，结构统一为：

```ts
export async function probeVideo(inputPath: string): Promise<VideoMetadata> {
  const startedAt = Date.now();
  logger.info('probeVideo started', { inputPath });

  try {
    const result = await runFfprobe(inputPath);
    logger.info('probeVideo completed', {
      inputPath,
      durationMs: Date.now() - startedAt,
      hasAudio: result.hasAudio,
    });
    return result;
  } catch (error) {
    logger.error('probeVideo failed', { inputPath, error });
    throw error;
  }
}
```

约定：

- 开始日志：函数名 + 关键输入。
- 成功日志：耗时 + 结果摘要，不打印大对象。
- 失败日志：函数名 + 输入 + 原始错误对象。
- 高频循环内部不逐条 `info`，必要时用 `debug`。

## 2. 日志库与输出

### 2.1 Electron 主进程

使用 `electron-log`，由 `electron/main/services/logger.ts` 统一封装：

```ts
import log from 'electron-log/main';

export type Logger = {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
};

export function createLogger(scope: string): Logger {
  const scoped = log.scope(scope);
  return {
    debug: (message, context) => scoped.debug(message, context ?? ''),
    info: (message, context) => scoped.info(message, context ?? ''),
    warn: (message, context) => scoped.warn(message, context ?? ''),
    error: (message, context) => scoped.error(message, context ?? ''),
  };
}
```

- 日志文件默认位于 Electron 的 `logs` 目录（本机实测为 `%APPDATA%\frameforge\logs\main.log`），以启动日志中的 `logFile` 字段为准。
- 格式包含：时间、级别、scope、消息、上下文。
- 启用文件轮转，避免长期运行无限增长。
- 生产环境不把完整堆栈直接弹给用户；UI 展示简短原因，详细堆栈进日志。

### 2.2 Renderer

- Renderer 不直接导入 Node 日志库，不接触 `fs`。
- UI 只展示经过映射的用户可读错误。
- 需要记录的渲染层异常，通过受控 IPC 交给主进程记录；该 IPC 必须校验参数，不能变成通用写文件接口。

### 2.3 测试与脚本

- `scripts/*.ts` 使用 `main()` + `stepXxx()` 结构，每个 step 用命名 logger 记录开始/成功/失败。
- Vitest 测试用断言判定成败；集成测试的每个真实步骤（生成样本、调用 ffprobe、调用 ffmpeg、校验输出）记录 `info`，失败记录 `error`。
- 测试日志输出到控制台即可，不写入用户日志目录，避免污染真实运行日志。

#### 测试日志约定

一个开发阶段对应一个测试文件，文件内部按流程分组；不把同一阶段拆成大量小文件。每个测试文件必须有中文头注释，至少说明：

1. 测试目标；
2. 对应哪条需求或安全边界；
3. 为什么这个断言重要。

每个测试用例自动记录：

```text
START 用例名称
STEP  关键步骤（由测试内部按需补充）
PASS  用例名称 { durationMs: 12 }
FAIL  用例名称 { state: 'fail', errors: [...] }
```

实现方式：

- `test/helpers/test-logger.ts`：使用真实 `electron-log/node`，关闭文件传输，只保留控制台。
- `test/setup.ts`：在全局 `beforeEach` / `onTestFinished` 中自动记录 START 与 PASS/FAIL/SKIP。
- 测试内部使用 `createTestLogger('scope')` 记录 STEP。
- 如果测试故意制造错误日志（例如验证 Error 序列化），必须在注释和 STEP 文案中写明“这是测试对象，不是用例失败”。
- `vitest.config.mts` 使用 `verbose` reporter，确保 `npm test` 能看到测试日志。

### 2.4 Python（仅在确实新增 Python 脚本时）

```python
import logging

logger = logging.getLogger(__name__)

def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    step_check_environment()
    step_run_conversion()

def step_check_environment() -> None:
    logger.info("checking environment")
    try:
        ...
    except Exception:
        logger.error("environment check failed", exc_info=True)
        raise
```

禁止用 `print()` 作为运行日志。

## 3. 级别使用

| 级别 | 用途 |
|---|---|
| `debug` | 高频轮询、进度明细、参数细节 |
| `info` | 启动、窗口创建、IPC 注册、任务状态迁移、转换完成 |
| `warn` | 可恢复异常、缩略图失败但可继续、输出名冲突自动改名 |
| `error` | 转换失败、FFmpeg 缺失、IPC 参数非法、未捕获异常 |

## 4. 阶段 1 的日志验收

- 启动开发模式后，日志文件真实存在。
- 日志中包含：
  - 应用启动
  - logger 初始化
  - IPC handlers 注册
  - 主窗口创建
- 人为触发一次受控错误（例如非法 IPC 参数），日志中出现 `error` 级别记录，UI 不出现原始堆栈。
- 自动化测试覆盖 logger 的级别过滤、错误序列化和日志目录创建。
