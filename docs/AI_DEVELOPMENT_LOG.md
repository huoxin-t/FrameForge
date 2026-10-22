# FrameForge AI 开发日志

> 记录规则：只记录真实执行过的命令、真实观察到的结果和真实发生的决策。未执行的测试写“未执行”，未经实测的推断写“尚未验证”。开发者未给出的反馈不代写。

---

## 2026-10-21｜阶段 0：仓库与环境核验、MCP 接入、实施计划

### 本轮目标

- 在 `D:\projecct\2026\vedio` 接入 AOCI-CODE MCP。
- 检查仓库、Node/npm、Git、操作系统、FFmpeg/FFprobe 环境。
- 识别 Windows 打包与 FFmpeg 分发风险。
- 给出分阶段、测试先行的实施计划。
- 本阶段不生成应用业务代码。

### 开发者决策

- 本轮尚无开发者对技术方案的确认或否决。以下“决策”均为 AI 提议，等待开发者查验后确认。
- 将原始输入文档归档为 `docs/PROJECT_SPEC.md` 与 `docs/AI_CODING_PROMPT.md`，后续以 `docs/PROJECT_SPEC.md` 为唯一规格来源。
- 当前目录原本不是 Git 仓库；为满足 `aoci scan`、阶段验收和最终 GitHub 交付要求，执行了 `git init`。
- 接入方式采用项目级 OpenCode MCP 配置（`opencode.json`），由 `aoci init` 自动生成；该文件按 AOCI 约定被 `.gitignore` 排除，不提交。

### AI 实际修改

- 初始化 Git 仓库（`git init`）。
- 执行 `aoci init --here --locale zh-CN --agent opencode`，生成：
  - `aoci.txt`、`aoci.meta.txt`、`aoci.code.txt`
  - `.aoci/`、`AGENTS.md`、`.gitattributes`
  - `opencode.json`（项目级 MCP 配置）
- 执行 `aoci scan`，基线建立成功。
- 移动输入文档：
  - `FrameForge_架构.md` → `docs/PROJECT_SPEC.md`
  - `FrameForge_prompt.md` → `docs/AI_CODING_PROMPT.md`
- 扩充 `.gitignore`：Node/Electron 构建产物、测试产物、编辑器与系统文件；未忽略 AOCI 认知资产。
- 新建本开发日志。

### 环境核验结果（真实执行）

| 项目 | 结果 |
|---|---|
| 操作系统 | Microsoft Windows NT 10.0.26200.0（Windows 11），AMD64 |
| Node.js | v22.22.3 |
| npm | 10.9.8 |
| Git | 2.45.2.windows.1 |
| npm registry | `https://registry.npmjs.org/` |
| D 盘可用空间 | 约 181.3 GiB |
| 现有项目 | 无 `package.json`、无应用源码，仅有规格文档 |
| FFmpeg | 8.0.1-full_build-www.gyan.dev，位于系统 PATH |
| FFprobe | 8.0.1-full_build-www.gyan.dev，位于系统 PATH |
| 编码器 | 构建配置显示包含 `libx264`、`libx265`、`aac`；尚未实际编码验证 |
| AOCI | v0.1.0-rc20，`D:\github\tools\aoci.exe` |
| AOCI scan | 成功：基线 8 个文件，耗时 448ms |
| AOCI 索引 | 0 条 Entry；完整索引尚未构建（等待代码成形后再建，避免空仓库索引反复失效） |
| MCP 工具 | 当前会话已能调用 `aoci_rules` / `aoci_header`，连接成功 |

FFmpeg 构建参数包含 `--enable-gpl --enable-version3`，说明该系统构建属于 GPL 构建。后续若随安装包分发 FFmpeg 二进制，必须在 README/第三方声明中如实说明来源与许可证义务；当前尚未选定要分发的二进制版本。

### 风险与待验证项

1. **打包后 FFmpeg 路径**：系统 PATH 在打包应用中不可依赖。计划优先随包分发 `ffmpeg`/`ffprobe`，开发模式与打包模式分别解析路径，并在阶段 2 用打包目录做一次真实探测。
2. **FFmpeg 再分发许可证**：`ffmpeg-static` 等 npm 包通常携带 GPL 构建。阶段 2 必须核实实际二进制版本、构建选项与许可证，不能只写“LGPL”。
3. **electron-builder 首次下载依赖**：Windows 上可能因下载 `winCodeSign` 或符号链接权限失败。阶段 1 末尾即执行一次 `--dir` 打包探测，不拖到阶段 5。
4. **Electron 最新版本兼容性**：将以 npm 实际安装版本为准，锁定版本并记录；不凭记忆假设 API。
5. **AOCI 索引维护成本**：当前为空骨架。计划在阶段 1 代码结构稳定后构建首次完整索引，之后按阶段收尾维护。
6. **中文/空格路径**：实现时全程使用参数数组与 `spawn(..., { shell: false })`，阶段 2/3 用真实中文与空格路径测试。

### 分阶段实施计划（测试先行）

每个阶段均按“先写失败测试 → 实现 → 测试通过 → 停止等待开发者查验”执行，不跨阶段提前实现。

#### 阶段 1：Electron 桌面骨架与安全边界

- 先写测试：
  - 窗口安全配置：`contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`、`webSecurity=true`。
  - preload 暴露面：仅包含约定的最小 API，不暴露 `ipcRenderer`、`invoke` 或通用命令执行。
  - renderer 边界：`src/**` 不得导入 `electron`、`node:fs`、`node:child_process`。
  - 最小 UI 冒烟：渲染标题、空状态、真实应用版本信息。
- 再实现：electron-vite + React + TypeScript + Tailwind；main/preload/renderer 分层；typed IPC；`getAppInfo` 一个真实 API；最小工作台。
- 验收命令：`npm test`、`npm run typecheck`、`npm run build`；手动 `npm run dev` 确认是 Electron 窗口；执行一次 `electron-builder --dir` 探测打包链路。
- 风险：Electron 与 Electron Builder 版本兼容、Tailwind v4 配置、沙箱 preload 的 CJS 输出。

#### 阶段 2：FFmpeg 环境、导入、元数据、缩略图

- 先写测试：
  - 帧率分数解析（`30000/1001`、`0/0`、缺失、`N/A`）。
  - 时长/文件大小格式化，未知值不出现 `NaN`。
  - ffprobe JSON 解析：首个视频流、可选音频流、无音轨、损坏输出。
  - 缩略图时间点回退逻辑与失败降级。
  - 路径校验（不存在、目录、非法扩展名）。
  - 真实 FFmpeg 集成测试：生成短视频样本，读取 metadata 与缩略图。
- 再实现：`ffmpeg-resolver`、`media-probe`、`thumbnail`、文件选择 IPC、导入 UI、加载态/失败态/占位图。
- 验收命令：`npm test`、`npm run typecheck`、真实视频手动导入；打包目录内 ffprobe/ffmpeg 路径探测。
- 风险：二进制分发路径、无音轨样本、缩略图对短视频失败、中文路径。

#### 阶段 3：真实转换与串行队列

- 先写测试：
  - MP4/MKV 参数构造，MKV 不得出现 `-movflags +faststart`。
  - `-progress pipe:1` 解析与 0–99% 上限。
  - 输出命名冲突策略（`_converted`、`(1)`、`(2)`）。
  - 状态机合法/非法迁移。
  - 真实集成：成功转换、取消终止子进程、损坏输入失败、无音轨转换、中文/空格路径、重名输出。
- 再实现：转换参数构建、临时文件、原子改名、队列串行调度、取消、错误映射、日志。
- 验收命令：`npm test`、`npm run typecheck`、真实文件手工转换与取消。
- 风险：取消时子进程树清理、临时文件残留、FFmpeg 进度字段语义。

#### 阶段 4：界面与异常体验

- 先写测试：空状态、加载态、元数据/缩略图展示、失败详情、长文件名、窄窗口、按钮可用性。
- 再实现：工作台布局、队列状态、整体进度、打开输出目录、FFmpeg 环境状态、错误详情。
- 验收：窄窗口与长文件名检查；所有按钮均有真实动作。
- 风险：为视觉效果引入无功能控件。

#### 阶段 5：测试、打包、交付文档

- 逐项核对 `docs/PROJECT_SPEC.md` 验收条件。
- 运行测试、类型检查、构建、Windows 打包；实际启动打包产物并完成一次导入 → metadata → 缩略图 → 转码 → 播放验证。
- 补全 `README.md`、`docs/TEST_PLAN.md`、`docs/SESSION_SUMMARY.md`、本日志。
- 风险：签名/安装包下载、打包后二进制路径、未实测项被误写为通过。

### 验证结果

- 实际执行：`git init`、`aoci init`、`aoci scan`、`aoci status`、`aoci_rules`、`aoci_header`、FFmpeg/FFprobe 版本检查、Node/npm/Git/OS/磁盘检查。
- 测试：本阶段无应用代码，未执行应用测试（未执行）。
- 构建：未执行（无项目骨架）。
- 真实观察：AOCI MCP 已连接，索引为空；FFmpeg 系统构建可用；仓库尚无 `package.json`。

### 当前风险与下一步

- 下一步：等待开发者查验阶段 0 的环境结论与实施计划；确认后进入阶段 1，先写测试再编码。
- 未决问题：
  - 是否接受随包分发 FFmpeg（会增加安装包体积并触发 GPL 再分发说明）。
  - 是否接受阶段 1 末尾执行一次 `electron-builder --dir` 作为打包预检。
  - 是否同意在阶段 1 代码稳定后构建 AOCI 完整索引。

### 证据

- Git commit：尚未提交（等待阶段 0 查验）。
- 命令输出：本轮终端记录；AOCI 基线 8 文件；FFmpeg 8.0.1-full_build。

---

## 2026-10-21｜开发者反馈：主函数编排与真实日志规范

### 开发者反馈（原始要求）

> 在开发步骤中，要主函数，然后在主函数里执行分函数。每个分函数都打日志 log，也要使用开发真实的工具，比如 Python 使用的是 `logger.info` / `logger.error`。

### 对反馈的理解与落地规则

1. **单一入口、主函数编排**
   - 应用主进程只保留一个启动入口 `main()`。
   - `main()` 不承载具体业务，只按顺序调用子函数，例如：
     - `initLogger()`
     - `resolveFfmpeg()`
     - `registerIpcHandlers()`
     - `createMainWindow()`
     - `registerAppLifecycle()`
   - 每个子函数只负责一件事，失败时向上抛出可识别的错误，由 `main()` 统一记录并决定退出行为。

2. **使用真实日志库，不用 `console.log` 代替**
   - Electron 主进程使用 `electron-log`，输出到控制台和用户日志目录，支持日志级别、时间戳、错误堆栈和文件轮转。
   - 每个服务模块创建自己的命名 logger，例如 `createLogger('media-probe')`。
   - 子函数至少记录：
     - 开始：函数名、关键输入（路径、格式、任务 ID）
     - 成功：耗时、结果摘要
     - 失败：`logger.error('...', error)`，保留错误堆栈和退出码
   - 禁止只写 `console.log('done')` 这类无法定位问题的日志。

3. **Python 脚本同样适用**
   - 本项目主技术栈是 TypeScript，不计划引入 Python。
   - 若后续确实新增 Python 辅助脚本，统一使用标准库 `logging`：
     ```python
     logger = logging.getLogger(__name__)
     logger.info("...")
     logger.error("...", exc_info=True)
     ```
   - 不使用 `print()` 作为运行日志。

4. **测试与开发脚本也采用主函数结构**
   - `scripts/` 下的环境检查、FFmpeg 冒烟、打包预检脚本统一写成：
     ```ts
     async function main(): Promise<void> {
       await stepCheckEnvironment();
       await stepCheckFfmpeg();
       await stepRunTests();
     }
     ```
   - 每个 `stepXxx()` 自己打开始/成功/失败日志；`main()` 负责顺序、汇总和退出码。
   - 测试断言仍以测试框架结果为准，日志只用于定位，不代替断言。

5. **日志不能刷屏**
   - FFmpeg 进度事件不逐行写日志，按百分比台阶（例如每 5%）或时间间隔记录。
   - 正常高频轮询使用 `debug`，失败与状态迁移使用 `info` / `warn` / `error`。

6. **敏感信息边界**
   - 日志记录本地文件路径、任务 ID、FFmpeg 退出码和错误摘要，便于诊断。
   - 不记录密钥、令牌或与项目无关的个人信息。

### 对阶段计划的调整

- 阶段 1 增加：
  - `electron/main/services/logger.ts`（封装 `electron-log`）。
  - 主进程 `main()` + 子函数编排结构。
  - 日志测试：验证级别、文件写入、错误对象序列化、日志目录可创建。
  - 验收时检查真实日志文件存在且包含启动、窗口创建、IPC 注册记录。
- 阶段 2/3 的 `media-probe`、`thumbnail`、`conversion-runner`、`conversion-queue` 每个公开函数都按上述规则记录开始/成功/失败。
- 阶段 5 交付文档补充日志位置、级别和查看方式。

### 验证结果

- 本轮仅确认规范并更新文档，未写应用代码。
- 应用测试、构建：未执行。

---

## 2026-10-21｜阶段 1：Electron 桌面骨架、安全边界与日志编排

### 本轮目标

- 建立 Electron + React + TypeScript + Vite/electron-vite 项目骨架。
- 建立 `main()` 主函数编排、独立服务函数和真实文件日志。
- 落实 contextIsolation、sandbox、nodeIntegration 关闭、最小 preload API、IPC 调用方校验和外部导航拦截。
- 提供一个不伪造业务功能的最小工作台。
- 先写测试，确认 RED，再实现到 GREEN。

### 开发者决策

- 开发者确认开始阶段 1。
- 开发者追加要求：主函数编排子函数；每个子函数使用真实 logger 记录日志，不使用零散 `console.log` 代替。
- 开发者询问了 FFmpeg 随包分发和打包预检的含义；本轮已解释，FFmpeg 分发方案仍待阶段 2 最终确认。
- 本轮选择：Electron 45、electron-vite 6、React 19、TypeScript 5.9、Vite 8、Tailwind CSS 4、Vitest 5、electron-builder 26。
- 本轮选择：固定 `sandbox: true`，preload 明确输出 CJS，避免沙箱 preload 与 ESM 不兼容。
- 本轮选择：`main()` 只做编排，启动顺序抽成可测试的 `runMain()`；真实工作放在 `initLogger`、`registerIpcHandlers`、`createMainWindow`、`registerAppLifecycle`。
- 本轮选择：先只暴露一个真实 API `getAppInfo()`，不提前加入文件选择、转码等未实现能力。

### AI 实际修改

新增/修改文件：

- `package.json`、`package-lock.json`、`.npmrc`
- `electron.vite.config.ts`、`vitest.config.mts`、`tsconfig.json`
- `index.html`、`README.md`
- `shared/ipc.ts`
- `electron/main/index.ts`
- `electron/main/orchestrator.ts`
- `electron/main/window-options.ts`
- `electron/main/security.ts`
- `electron/main/ipc/handlers.ts`
- `electron/main/ipc/guard.ts`
- `electron/main/services/logger.ts`
- `electron/main/services/logger-core.ts`
- `electron/main/services/app-info.ts`
- `electron/preload/index.ts`
- `electron/preload/api.ts`
- `electron/preload/types.d.ts`
- `src/App.tsx`
- `src/main.tsx`
- `src/components/AppShell.tsx`
- `src/components/EmptyState.tsx`
- `src/components/EnvironmentPanel.tsx`
- `src/styles/index.css`
- `src/types/global.d.ts`
- `test/setup.ts`
- `test/unit/app-info.test.ts`
- `test/unit/app.test.tsx`
- `test/unit/ipc-contract.test.ts`
- `test/unit/logger.test.ts`
- `test/unit/orchestrator.test.ts`
- `test/unit/renderer-boundary.test.ts`
- `test/unit/security.test.ts`
- `test/unit/window-options.test.ts`
- `docs/LOGGING.md`（日志规范）

关键实现：

- `main()` 在 `app.whenReady()` 后调用 `runMain()`，按固定顺序执行四个启动阶段。
- `electron-log` 同时写控制台和文件；文件级别 `info`，控制台开发模式 `debug`；单文件上限 5 MB。
- 每个主进程阶段记录开始/完成日志；IPC 成功请求记录 `info`，未受信调用记录 `error`。
- 窗口配置：1360×860、最小 1024×680、`contextIsolation`、`sandbox`、`webSecurity` 开启，`nodeIntegration` 关闭，打包版关闭 DevTools。
- preload 只暴露 `getAppInfo()`，输出确认为 CJS：`require("electron")`。
- IPC handler 校验 `event.sender.id` 必须等于当前主窗口的 `webContents.id`。
- 拒绝 `window.open`，并阻止导航到非当前页面。
- renderer 不导入任何 Node/Electron 模块；测试扫描 `src/**` 强制检查。
- 最小工作台只展示真实的运行环境信息和诚实的“尚未接入”空状态，没有假按钮、假进度或假统计。

### 测试与验证结果（真实执行）

#### 1. 测试先行 RED

首次执行 `npm test`：

```text
Test Files  8 failed (8)
Tests       2 failed (2)
```

- 7 个套件因目标模块尚不存在而无法解析。
- `renderer-boundary.test.ts` 因 `src/` 目录尚不存在而失败。
- 这确认测试确实在实现之前运行，不是补写的事后测试。

#### 2. 实现后 GREEN

```text
npm test

Test Files  9 passed (9)
Tests       24 passed (24)
Duration    8.04s
```

覆盖：

- preload API 暴露面与危险能力排除。
- 窗口安全配置。
- 导航拦截与 `window.open` 拒绝。
- 真实 `electron-log` 文件写入、级别过滤、Error 堆栈序列化。
- 运行环境信息映射。
- `runMain()` 启动顺序与失败短路。
- renderer 禁止 Node/Electron 导入与 CommonJS `require`。
- 工作台渲染成功态与错误态。

#### 3. 类型检查

```text
npm run typecheck
```

结果：通过（退出码 0）。

修复过程：首次类型检查发现 `src/App.tsx` 存在未使用的 `AppInfo` 类型导入；删除后重新执行通过。

#### 4. 生产构建

```text
npm run build
```

结果：通过。

```text
out/main/index.js                 7.53 kB
out/preload/index.js              0.46 kB
out/renderer/index.html           0.40 kB
out/renderer/assets/index-*.css  14.26 kB
out/renderer/assets/index-*.js  585.20 kB
```

#### 5. 开发模式真实窗口

```text
npm run dev
```

真实观察：

- Electron 进程启动，主窗口标题为 `FrameForge`。
- 日志文件：`C:\Users\ASUS\AppData\Roaming\frameforge\logs\main.log`。
- 日志包含：`FrameForge starting`、`Logger initialized`、`IPC handlers registered`、`Creating main window`、`Loading renderer`、`Main window loaded`、`App lifecycle registered`、`Main window shown`。
- 日志出现 `Handled IPC request { channel: 'app:get-info' }`，证明 preload 桥接与真实 IPC 链路可用。
- 开发模式下 React StrictMode 导致启动时 `getAppInfo` 被调用两次；这是开发模式的预期行为，不是重复注册 handler。

#### 6. Windows 打包预检

```text
npm run dist:dir
```

结果：成功生成 `release/win-unpacked/FrameForge.exe`。

真实启动打包产物后观察：

- 进程 `FrameForge` 持续运行，窗口标题 `FrameForge`，`Responding = True`。
- 打包版日志显示 `packaged` 相关的 file URL：
  `file:///D:/projecct/2026/vedio/release/win-unpacked/resources/app.asar/out/renderer/index.html`
- 打包版同样出现 `Handled IPC request { channel: 'app:get-info' }`，证明 asar 内 renderer、preload 和主进程链路可用。

### 真实遇到的问题与修复

1. **Electron 二进制未安装**
   - 首次 `npm run dev` 报错：`Error: Electron uninstall`。
   - 原因：`npm install` 完成后 `node_modules/electron/dist` 为空，Electron 二进制没有下载成功。
   - 进一步排查：当前网络无法连接 `github.com:443`；`npmmirror.com` 镜像可访问。
   - 处理：使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重新执行 Electron 安装脚本，安装成功，`electron.exe --version` 输出 `v45.0.0`。
   - 已新增 `.npmrc` 记录镜像配置，避免后续安装再次失败。

2. **Vite 配置 ESM/CJS 警告**
   - `vitest.config.ts` 在无 `"type": "module"` 的包中被当作 CJS 加载，出现 ESM 语法警告。
   - 处理：重命名为 `vitest.config.mts`，警告消失。

3. **打包版默认图标**
   - electron-builder 输出 `default Electron icon is used reason=application icon is not set`。
   - 当前未添加应用图标，不阻塞阶段 1；阶段 4/5 再补。

### 未执行 / 尚未验证

- 未执行真实视频导入、metadata、缩略图、转码（属于阶段 2/3）。
- 未执行自动化 Electron E2E 测试；本轮窗口验证为人工启动进程 + 检查窗口标题 + 日志证据。
- 未验证无 FFmpeg 环境下的错误提示（阶段 2）。
- 未添加 CSP；当前安全边界为窗口配置、导航拦截、最小 preload 和 IPC 校验。CSP 计划在阶段 4/5 评估。
- AOCI 完整索引仍未构建（0 条 Entry），当前只完成 MCP 接入与基线扫描。

### 当前风险与下一步

- 下一步：等待开发者查验阶段 1 的窗口、日志、测试和打包目录版。
- 查验通过后进入阶段 2：先写解析与真实 FFmpeg 集成测试，再实现文件导入、metadata、缩略图。
- 阶段 2 前需确认 FFmpeg 分发方案：随包分发（安装包更大、需 GPL 说明）或依赖系统 FFmpeg。

### 证据

- Git commit：尚未提交（等待阶段 1 开发者查验）。
- 日志：`C:\Users\ASUS\AppData\Roaming\frameforge\logs\main.log`
- 打包目录：`D:\projecct\2026\vedio\release\win-unpacked\FrameForge.exe`
- 阶段 1 窗口截图：`docs/evidence/phase1-window.png`（使用 PrintWindow 抓取打包版窗口，避免被其他窗口遮挡）
- 测试：`npm test` 9 个文件 / 24 个测试通过。

---

## 2026-10-21｜开发者反馈：测试缺少注释与日志

### 开发者反馈（原始要求）

> 很好，问题是测试咋没注释和日志啊。

### 对反馈的理解

阶段 1 的测试虽然有 24 个断言，但存在两个问题：

1. 测试文件没有说明“为什么测这项、对应哪条需求、断言失败意味着什么”。
2. 测试执行时只有最终红绿结果，没有 START / STEP / PASS / FAIL 过程日志，出问题后难以判断卡在哪一步。

这不是功能缺陷，而是可维护性和可验证性问题，必须补上。

### AI 实际修改

- 新增 `test/helpers/test-logger.ts`：
  - 使用真实 `electron-log/node`，不使用假日志器。
  - 关闭文件传输，只输出控制台，避免污染 `%APPDATA%\frameforge\logs\main.log`。
  - 提供 `createTestLogger(scope)` 给各测试文件记录 STEP。
- 修改 `test/setup.ts`：
  - 全局 `beforeEach` 自动记录 `START 用例名`。
  - `onTestFinished` 自动记录 `PASS` / `FAIL` / `SKIP`，PASS 带真实耗时，FAIL 带错误对象。
  - 保留 React Testing Library 的 `cleanup()`。
- 修改 `vitest.config.mts`：
  - 使用 `verbose` reporter，确保 `npm test` 输出测试日志。
- 为全部 9 个测试文件补充中文头注释和用例注释：
  - 说明测试目标、对应需求、断言原因。
  - 复杂用例增加 `STEP` 日志，例如创建临时目录、写入日志、等待文件、断言顺序。
- 在日志序列化测试中注明：
  - 预期出现的 `[error]` stderr 是测试对象，不是用例失败。

### 验证结果（真实执行）

```text
npm test -- --reporter=dot

Test Files  9 passed (9)
Tests       24 passed (24)
```

实际观察到的日志示例：

```text
[info] [test:lifecycle] START writes scoped info logs to a real file
[info] [test:logger-test] STEP 创建临时日志目录
[info] [test:logger-test] STEP 写入 info 日志 { file: '...\\main.log' }
[info] [test:logger-test] STEP 读取并断言日志内容 { bytes: 238 }
[info] [test:lifecycle] PASS writes scoped info logs to a real file { durationMs: 15 }
```

```text
npm run typecheck
```

结果：通过。

### 当前风险与下一步

- 测试日志现在较详细，`npm test` 输出会比之前长；这是开发者明确要求可观察性的结果。
- 下一步仍等待开发者查验阶段 1；通过后进入阶段 2。
- 阶段 2 的测试同样遵循：中文头注释 + START/STEP/PASS/FAIL + 真实 FFmpeg/FFprobe 样本。

---

## 2026-10-21｜阶段 2：真实媒体导入、FFprobe 元数据与缩略图

### 本轮目标

- 通过系统文件选择器一次导入多个视频。
- 用真实 `ffprobe` 读取时长、分辨率、帧率、容器格式、视频/音频编码和文件大小。
- 用真实 `ffmpeg` 生成并显示缩略图。
- 处理中文/空格路径、无音轨视频、损坏文件、未知帧率和 FFmpeg 缺失。
- 先写测试并确认真实失败，再实现，再跑绿；本阶段不实现转换和队列。

### 开发者反馈与决策

- 阶段 1 查验后开发者要求：“开始往下吧”，进入阶段 2。
- 开发者要求：一个开发阶段只保留一个测试文件，文件内按流程分组；测试必须有中文注释和真实 START/STEP/PASS/FAIL 日志。
- 阶段 1 原有 9 个测试文件已合并为 `test/phase-01-skeleton.test.tsx`，24 个测试保留。旧日志中的“9 个文件 / 24 个测试”是合并前记录。
- 开发模式继续使用系统 FFmpeg；随包分发和 GPL 许可证核对留到阶段 5，不在阶段 2 伪装成已完成。
- 当前开发机 FFmpeg：`8.0.1-full_build-www.gyan.dev`，目录 `D:\GITHUB\ffmpeg-8.0.1-full_build-shared\bin`。

### AI 实际修改

- 共享契约：
  - 新增 `shared/media.ts`：媒体元数据、缩略图、导入项、FFmpeg 状态类型。
  - 新增 `shared/media-format.ts`：时长、帧率、文件大小、分辨率格式化。
  - 扩展 `shared/ipc.ts`：`getFfmpegStatus`、`selectVideos` 两个受控 API。
- FFmpeg 基础设施：
  - 新增 `electron/main/services/ffmpeg/process.ts`：
    - 统一 `spawn(executable, args, { shell: false })`；
    - 收集 stdout/stderr、退出码、超时和取消信号；
    - 记录真实进程日志。
  - 新增 `electron/main/services/ffmpeg/resolver.ts`：
    - 解析顺序：`FRAMEFORGE_FFMPEG_DIR` → 随包目录 → 系统 PATH；
    - 必须同目录同时存在 ffmpeg 与 ffprobe。
  - 新增 `electron/main/services/ffmpeg/status.ts`：
    - 真实执行 `ffmpeg -version` / `ffprobe -version`；
    - 解析版本、缓存状态；
    - 加入 in-flight 去重，启动预热和 renderer 首次请求共享同一次检测，避免重复启动两对进程。
- 媒体服务：
  - 新增 `electron/main/services/media/probe.ts`：
    - 绝对路径、扩展名、存在性、普通文件、可读性校验；
    - ffprobe 参数数组；
    - JSON 解析、分数帧率、容器映射、编码名称映射；
    - 坏文件错误转换。
  - 新增 `electron/main/services/media/thumbnail.ts`：
    - 真实 ffmpeg 单帧抽取；
    - 320×180 letterbox JPEG，避免不同宽高比把 UI 挤变形；
    - 2 秒以上优先第 1 秒，失败回退第 0 帧；
    - 临时文件读取为 `data:` URL 后删除。
  - 新增 `electron/main/services/media/media-service.ts`：
    - 逐文件执行“探测 → 缩略图”；
    - 元数据失败只标记单项；
    - 缩略图失败只降级为占位图。
- IPC 与 preload：
  - `handlers.ts` 增加 `ffmpeg:get-status`、`media:select-videos`；
  - 系统文件选择器支持多选，扩展名过滤来自共享常量；
  - 所有新 IPC 仍校验调用方为当前主窗口；
  - preload 只暴露 `getAppInfo`、`getFfmpegStatus`、`selectVideos`。
- 渲染层：
  - `App.tsx` 管理空状态、加载、错误、媒体列表和重复路径合并；
  - 新增 `MediaCard`、`MediaList`；
  - `AppShell` 显示 FFmpeg 状态；
  - `EnvironmentPanel` 显示 FFmpeg/FFprobe 版本、来源和路径；
  - `EmptyState` 的导入按钮在 FFmpeg 未就绪或读取中禁用。
- 文档与忽略项：
  - 新增 `docs/FFMPEG.md`：路径方案、打包计划、shared/static 构建差异、GPL 注意事项。
  - 更新 `README.md`、`docs/LOGGING.md`。
  - `.gitignore` 增加 `resources/ffmpeg/`，禁止提交第三方二进制。
- 测试：
  - 新增 `test/phase-02-media.test.tsx`，覆盖格式化、解析、路径、FFmpeg 解析/状态、真实探测、真实缩略图、服务降级、preload 契约和导入 UI。
  - 更新阶段 1 的 API 断言与 App mock，使其适配阶段 2 的扩展契约。

### 测试先行：真实 RED

执行：

```text
npx vitest run test/phase-02-media.test.tsx
```

真实结果：

```text
Failed Suites 1
Error: Failed to resolve import "../electron/main/services/media/probe"
```

原因符合预期：测试文件和待实现模块先写，实现尚不存在。记录在 `test-results/phase2-red.log`。

### 实现过程中发现并修复的问题

1. **MKV 被识别成 WebM**
   - 原因：`matroska,webm` 同时包含两个关键字，判断顺序只看 format_name。
   - 修复：优先看扩展名，`.mkv` → MKV，`.webm` → WebM。
2. **目录路径被报成“不支持的文件类型”**
   - 原因：先检查扩展名，再 `stat`。
   - 修复：先 `stat` 判断是否为普通文件，再检查扩展名；目录返回“路径不是文件”。
3. **无音轨 UI 断言无法匹配**
   - 原因：React 把元数据拆成多个文本节点和分隔 span。
   - 修复：改为对整张卡片的 `textContent` 断言，不改变用户可见文案。
4. **启动时重复检测 FFmpeg**
   - 原因：IPC 预热和 renderer 首次 `getFfmpegStatus` 并发。
   - 修复：`FfmpegService` 增加 pending Promise 去重，并补并发测试。
5. **手动测试里误触发了本机真实文件导入**
   - 事实：开发窗口真实导入了一个本机 MP4，日志确认 ffprobe 和缩略图链路成功。
   - 处理：没有把这个个人文件截图放进仓库；仓库只保留空状态截图，避免泄露文件名。

### 测试 GREEN（真实执行）

阶段 2 单文件：

```text
npx vitest run test/phase-02-media.test.tsx

Test Files  1 passed (1)
Tests       26 passed (26)
```

全量：

```text
npm test

Test Files  2 passed (2)
Tests       50 passed (50)
```

其中：

- 阶段 1：24 个测试；
- 阶段 2：26 个测试；
- 真实 FFmpeg/FFprobe 集成用例在本机实际执行，没有被跳过。

其他命令：

```text
npm run typecheck   通过
npm run build       main / preload / renderer 构建通过
npm run dist:dir    生成 release/win-unpacked/FrameForge.exe
```

### 真实环境验证

- FFmpeg 状态：
  - `ffmpeg 8.0.1`
  - `ffprobe 8.0.1`
  - 来源 `system`
  - 路径 `D:\GITHUB\ffmpeg-8.0.1-full_build-shared\bin`
- 真实样本：
  - 2 秒、320×240、30 fps、带 AAC 音轨的 MP4；
  - 1 秒、320×240、25 fps、无音轨 MP4；
  - 中文/空格目录与文件名；
  - 伪造的损坏 MP4。
- 验证结果：
  - ffprobe 读出时长、分辨率、30/25 fps、MPEG-4、AAC、MP4；
  - 缩略图为 320×180 JPEG，base64 解码后大小和 JPEG 头有效；
  - 无音轨视频不失败，缩略图仍生成；
  - 损坏文件返回可读错误，其他文件不受影响；
  - 真实 UI 导入触发过 `media-probe`、`media-thumbnail`、`media-service` 完整链路。
- 打包版：
  - `release/win-unpacked/FrameForge.exe` 启动成功；
  - 日志出现 `FrameForge starting { packaged: true }`；
  - 打包版仍从系统 PATH 找到 FFmpeg 8.0.1 并显示“FFmpeg 已就绪”；
  - 启动日志确认 in-flight 去重后只执行一次 FFmpeg 状态检查；
  - 截图：`docs/evidence/phase2-packaged.png`。

### 证据

- RED：`test-results/phase2-red.log`
- 中间失败：`test-results/phase2-run1.log`、`phase2-run2.log`
- 阶段 2 绿：`test-results/phase2-final2.log`
- 打包日志：`test-results/phase2-dist2.log`
- 开发窗口截图：`docs/evidence/phase2-empty.png`
- 打包窗口截图：`docs/evidence/phase2-packaged.png`

### 未执行 / 尚未验证

- 未在打包版中自动导入视频：打包版只验证了启动、IPC 和 FFmpeg 状态；导入链路由真实集成测试覆盖。
- 未把 FFmpeg 二进制打进安装包，也未在没有系统 FFmpeg PATH 的机器上验证随包路径。
- 未实现拖拽导入、自定义 FFmpeg 路径设置页。
- 未实现转换、任务队列、进度、取消和输出冲突处理（阶段 3/4）。
- 未做自动化 Electron E2E；本轮窗口验证是真实启动 + UIA 文本检查 + 日志 + PrintWindow 截图。
- AOCI 完整索引仍是 0 条 Entry，当前不作为可用认知使用。
- 阶段 2 收尾时调用过 `aoci_maintain`，返回 `blocked`：48 个代码对象待建立索引，需要先完成完整索引/范围确认；阶段 2 没有在不完整索引上强行生成 48 条语义，留待代码稳定后统一处理。

### 当前风险与下一步

- FFmpeg 随包分发仍是阶段 5 的主要风险：shared build 必须复制全部 DLL，且 GPL 再分发义务必须确认。
- 下一步进入阶段 3：输出格式/质量预设、输出目录、真实转换参数与转换前检查；仍按“先写测试 → RED → 实现 → GREEN”推进。
- 阶段 2 到此停下，等待开发者检查导入界面、真实媒体信息和缩略图。

---

## 2026-10-21｜阶段 3：真实转换、串行队列、进度与取消

### 本轮目标

- 只实现真实转码与串行任务队列，不提前做阶段 4 的打开文件/目录、关闭提示和拖拽等体验收尾。
- MVP 支持 MP4/MKV，按容器构造参数。
- 使用 `-progress pipe:1 -nostats` 读取真实进度，成功前最多 99%。
- 退出码成功、输出文件存在且大小大于 0 后才标记 `completed`。
- 实现取消、失败日志、唯一输出名、临时输出和清理。
- 测试并报告：成功转换、取消、失败、无音轨、目标文件名冲突。

### 开发者反馈与决策

- 开发者在阶段 2 查验后回复“继续”，进入阶段 3。
- 继续遵守一个阶段一个测试文件、中文注释、真实 START/STEP/PASS/FAIL、不伪造测试结果的要求。
- 继续使用系统 FFmpeg 做开发与集成测试；随包分发和许可证核对仍留到阶段 5。
- 转换默认单任务串行；一个任务失败不能清空后续任务。

### AI 实际修改

- 共享契约：
  - 新增 `shared/conversion.ts`：MP4/MKV、三档质量预设、任务状态、任务快照、IPC 事件类型。
  - 扩展 `shared/ipc.ts`：输出目录选择、启动转换、取消转换、进度订阅通道和七个 DesktopAPI 方法。
- 转换服务：
  - `conversion/args.ts`：按容器构造真实 FFmpeg 参数；MP4 专属 `-movflags +faststart`，无音轨使用 `-an`。
  - `conversion/output.ts`：`_converted` 命名、`(1)/(2)` 冲突避让、输出目录校验、临时文件命名。
  - `conversion/progress.ts`：解析 `out_time_us`、`out_time_ms`、`out_time`，处理跨 chunk 行，封顶 99%。
  - `conversion/runner.ts`：真实执行、临时文件、退出码/文件大小校验、stderr 摘要、取消和清理。
  - `conversion/queue.ts`：串行状态机、失败隔离、排队/运行取消、唯一输出预留、`waitForIdle()`。
  - `conversion/validation.ts`：IPC 输入格式、绝对路径、格式/预设白名单校验。
- 子进程封装：
  - `process.ts` 增加 `onStdout` 流式回调，供进度解析使用。
  - 取消时先 `kill()`，等待 `close` 确认进程退出；3 秒兜底避免 Promise 永久挂起。
- IPC/preload：
  - 新增 `conversion:select-output-directory`、`conversion:start`、`conversion:cancel`、`conversion:update`。
  - 进度事件由主进程推送到当前主窗口；preload 只暴露带取消订阅函数的 `onConversionUpdate`。
  - 所有新 IPC 继续校验调用方是当前主窗口。
- 渲染层：
  - 新增 `ConversionSettings`：输出格式、质量预设、输出目录、开始转换、错误提示。
  - 新增 `JobQueue`：真实状态、进度条、错误、可展开 stderr、取消按钮。
  - `App.tsx` 订阅进度事件、合并启动响应与事件、去重任务；有排队/运行任务时禁用再次启动。
  - 阶段 3 仍隐藏无实际功能的按钮；空状态不显示“开始转换”。
- 测试：
  - 新增 `test/phase-03-conversion.test.tsx`，一个文件覆盖参数、命名、进度、队列、真实 FFmpeg、Runner 清理、preload 和 UI。
  - 更新阶段 1/2 的 DesktopAPI mock 与阶段 2 的重复文案断言。

### 测试先行：真实 RED

执行：

```text
npx vitest run test/phase-03-conversion.test.tsx
```

真实结果：

```text
Failed Suites 1
Error: Failed to resolve import "../electron/main/services/conversion/args"
Tests  no tests
```

原因符合预期：测试和模块契约先写，实现尚未创建。记录在 `test-results/phase3-red.log`。

### 实现过程中发现并修复的问题

1. **阶段 2 断言被阶段 3 新文案影响**
   - 现象：全量测试第一次运行出现 `getByText(/MP4/)` 匹配到多个元素。
   - 原因：右侧“输出格式”下拉和质量预设描述也包含 MP4、H.264、AAC。
   - 修复：阶段 2 的媒体字段断言限定在 `article` 媒体卡片内，不删减用户可见文案。
2. **FFmpeg 进度字段语义**
   - `out_time_us` 和 `out_time_ms` 在 FFmpeg 8.0.1 中都按微秒输出，`out_time_ms` 的名称有历史歧义。
   - 解析器统一按微秒换算，并用单元测试覆盖 `out_time_us`、`out_time_ms`、timecode 和跨 chunk。
3. **短视频没有中间进度**
   - 现象：4 秒视频默认 0.5 秒统计周期时只看到 `progress=end`。
   - 修复：参数加入 `-stats_period 0.2`；真实集成测试观察到中间进度 `[31, 98]`。
4. **退出码 0 仍可能没有有效输出**
   - 增加 Runner 用例：FFmpeg 返回 0 但没有临时文件时仍然 `failed`，不显示 100%。
5. **队列运行中可重复启动**
   - 修复：只要有 `queued`/`running` 任务，界面禁用“开始转换”，避免同一批任务被重复提交。

### 测试 GREEN（真实执行）

阶段 3 单文件：

```text
npx vitest run test/phase-03-conversion.test.tsx

Test Files  1 passed (1)
Tests       23 passed (23)
```

全量：

```text
npm test

Test Files  3 passed (3)
Tests       73 passed (73)
```

其中：

- 阶段 1：24 个；
- 阶段 2：26 个；
- 阶段 3：23 个；
- 真实 FFmpeg/FFprobe 集成用例在本机实际执行，没有 skip。

其他命令：

```text
npm run typecheck   通过
npm run build       main / preload / renderer 构建通过
npm run dist:dir    生成 release/win-unpacked/FrameForge.exe
```

### 真实环境验证

- 真实 MP4 成功：
  - 输入：中文/空格目录中的 4 秒、640×360、30 fps、带 AAC 音轨 MP4；
  - 输出：`测试 视频_converted.mp4`，107,588 字节，4,017ms，H.264 + AAC；
  - 队列收到的真实中间进度：`[31, 98]`，完成后才 100%。
- 真实 MKV 无音轨：
  - 输入：1 秒、320×240、无音轨 MP4；
  - 输出：`无音轨 视频_converted.mkv`，9,600 字节，H.264，`hasAudio=false`。
- 目标文件名冲突：
  - 预先写入 `测试 视频_converted.mp4`；
  - 转换生成 `测试 视频_converted (1).mp4`；
  - 旧文件内容仍为 `DO NOT OVERWRITE`。
- 损坏文件：
  - 任务状态 `failed`；
  - 输出目录没有残留文件或 `.part-*` 临时文件。
- 取消：
  - 真实长耗时 FFmpeg 在 300ms 后收到 AbortSignal，约 333–348ms 内结束并返回 `ABORTED`；
  - 队列取消用例验证 signal 被中止、状态为 `canceled`、排队任务不会启动。
- 打包版：
  - `release/win-unpacked/FrameForge.exe` 启动成功；
  - 日志 `packaged: true`，IPC 注册了七个通道；
  - Chromium 156、Electron 45、Node 24 实际运行；
  - DOM 中能看到“任务队列”和新的转换 API；
  - 通过 preload 直接调用 `startConversions` 做真实端到端转换：生成 72,265 字节 H.264 320×240 MP4，任务队列显示“已完成 / 100%”；
  - 空状态截图：`docs/evidence/phase3-packaged.png`。

### 证据

- RED：`test-results/phase3-red.log`
- 阶段 3 单文件绿：`test-results/phase3-second.log`
- 全量绿：`test-results/phase3-full3.log`
- 构建：`test-results/phase3-build2.log`
- 打包：`test-results/phase3-dist.log`
- 打包版端到端：`test-results/phase3-e2e.log`；截图 `test-results/phase3-e2e/e2e.png`
- 打包版空状态：`docs/evidence/phase3-packaged.png`
- 收尾全量：`test-results/phase3-final.log`（73/73）
- 收尾构建：`test-results/phase3-final-build.log`
- 收尾目录版：`test-results/phase3-final-dist.log`
- 收尾打包版启动：`test-results/phase3-final-startup.log`

### 未执行 / 尚未验证

- 未自动化点击原生文件选择器；打包版端到端转换是直接通过 preload 调用转换 API，导入 UI 由阶段 2 的真实手动验证和 jsdom 测试覆盖。
- 未在真正通过 ACL 禁止写入的目录上做手工验证；已有“不存在/不是目录”校验和 FFmpeg 失败路径。
- 未实现应用关闭时提示正在运行的任务。
- 未实现打开输出文件/目录、转换完成通知、拖拽导入、设置持久化。
- 未保留字幕轨，未做硬件加速。
- 未把 FFmpeg 二进制打进安装包，也未在没有系统 PATH 的机器上验证随包路径。
- AOCI 完整索引仍为 0 条 Entry；阶段 3 没有在不完整索引上强行生成批量语义。

### 当前风险与下一步

- FFmpeg 随包分发和 GPL 义务仍是阶段 5 的主要交付风险。
- 阶段 4 进入产品体验收尾：打开文件/目录、关闭提示、拖拽导入、更多错误与加载状态；只保留真实可用控件。
- 阶段 3 到此停下，等待开发者检查转换设置、真实进度、取消和输出文件。

---

## 2026-10-21｜阶段 4：功能型产品体验收尾

### 本轮目标与边界

- 开发者要求先完成第四阶段，之后再根据设计网站/UI 组件库指挥视觉方向。
- 本轮只做功能型 UX 收尾，不引入新的 UI 框架，不做纯视觉大改。
- 保持所有新控件真实可用：打开文件/目录、复制错误、打开日志目录、拖拽导入、快捷键和关闭保护。
- 开始前列出的三处主要可用性缺口：
  1. 完成任务没有打开文件/所在目录的入口；
  2. 失败任务只能看摘要，不能快速复制错误或定位日志；
  3. 导入只支持按钮，缺少拖拽和常用快捷键；关闭窗口可能直接丢掉运行中的任务。

### 测试先行

先新增 `test/phase-04-polish.test.tsx`，覆盖：

- 拖拽导入路径的绝对路径、扩展名、数量和去重校验；
- 剪贴板文本的空值和长度上限；
- 只允许打开已完成任务的真实输出文件；
- 日志目录存在性校验；
- 有任务时关闭窗口的确认、取消全部任务和等待退出；
- 队列按 id 查询、忙碌判断和取消全部；
- preload 新增方法及 IPC 通道；
- 产品文案、拖拽进入/离开/放下、完成/失败操作、日志目录和 `Ctrl+O`。

首次执行真实 RED：

```text
Failed to resolve import "../electron/main/services/close-guard"
Tests  no tests
```

记录：`test-results/phase4-red.log`。

### 实现内容

- 主进程新增：
  - `media/import-validation.ts`：拖拽路径校验和大小写不敏感去重；
  - `conversion/output-actions.ts`：按任务状态和文件存在性打开输出/定位目录；
  - `system/open-path.ts`、`system/path-exists.ts`：只打开主进程确认存在的目录；
  - `close-guard.ts`：关闭确认、取消队列、等待真实子进程退出；
  - `validation.ts` 增加剪贴板文本校验；
  - `queue.ts` 增加 `getJob`、`hasActiveJobs`、`cancelAll`。
- IPC 新增 `media:import-paths`、`shell:open-output-file`、`shell:show-output-in-folder`、`clipboard:write-text`、`shell:open-log-directory`。
- preload 通过 Electron `webUtils.getPathForFile` 获取拖拽文件路径，不使用 `File.path`；`DesktopAPI` 从 7 个方法扩展到 13 个方法。
- 主窗口接入关闭保护；确认后调用 `cancelAll()` 并等待 `waitForIdle()`，再关闭窗口。
- renderer 新增拖拽进入/离开/放下状态、`Ctrl+O`、`Ctrl+Enter`、完成任务打开操作、失败任务复制错误/打开日志，以及队列汇总。
- `JobQueue` 对完成/失败任务显示真实操作按钮；复制反馈显示“已复制/复制失败”。
- `EnvironmentPanel` 增加真实日志目录入口。
- 删除工作台中的“阶段 3”开发文案，补上空状态拖拽与快捷键提示。

### 实现中发现并修复的问题

1. **非数组导入路径报错信息不准确**
   - 测试要求传入字符串时提示路径错误；最初统一落到“请至少选择一个视频文件”。
   - 修复：非数组与空数组分别报错。
2. **`Ctrl+O` 提示在页脚和空状态各出现一次**
   - Testing Library 的 `getByText` 因多个匹配失败。
   - 修复：测试改为 `getAllByText`，不删除两处真实有用的提示。
3. **拖拽文件路径不能用 `File.path`**
   - 使用 preload 的 `webUtils.getPathForFile(file)`，并对异常返回空字符串，renderer 再显示可读错误。
4. **关闭保护的 `preventDefault` 必须同步执行**
   - 在 `createCloseGuard` 中先同步调用 `event.preventDefault()`，再进行异步确认；避免窗口在对话框前关闭。
5. **打开输出不能接受任意路径**
   - renderer 只传任务 ID；主进程从队列取出任务，再验证 `status === 'completed'` 和输出文件存在。
6. **复制内容需要边界**
   - 主进程只接受非空、最长 20,000 字符的文本，避免异常大对象进入剪贴板。

### 测试 GREEN（真实执行）

阶段 4 单文件：

```text
npx vitest run test/phase-04-polish.test.tsx

Test Files  1 passed (1)
Tests       14 passed (14)
```

全量：

```text
npm test

Test Files  4 passed (4)
Tests       87 passed (87)
```

其他命令：

```text
npm run typecheck   通过
npm run build       main / preload / renderer 构建通过
npm run dist:dir    生成 release/win-unpacked/FrameForge.exe
```

### 打包版真实交互验证

使用 `test-results/phase4-e2e-run.mjs` 启动 `release/win-unpacked/FrameForge.exe`，通过 CDP 连接真实 renderer：

- 使用 `Input.dispatchDragEvent` 派发带真实文件路径的拖拽；工作区显示“松开以导入视频”，放下后出现媒体卡片；
- 真实导入中文/空格路径的 4 秒 640×360 带音轨 MP4，缩略图为 JPEG data URL；
- 通过 preload 启动真实转换，输出 423,499 字节 MP4；`ffprobe` 校验为 H.264 640×360；
- 队列 DOM 显示“完成 1 / 1”“已完成”“100%”和“打开文件 / 打开所在目录”；
- `copyText` 写入后由 PowerShell `Get-Clipboard` 读回 `FrameForge 阶段 4 剪贴板验证`；
- `openOutputFile('missing-job')` 被主进程拒绝，错误为“任务尚未成功完成，无法打开输出文件”；
- 窄窗口截图无横向溢出。

结果记录：`test-results/phase4-final-e2e.log`。

### 截图与证据

- 打包版工作台：`docs/evidence/phase4-packaged.png`
- 窄窗口：`docs/evidence/phase4-narrow.png`
- RED：`test-results/phase4-red.log`
- 单文件绿：`test-results/phase4-green-3.log`（14/14）
- 全量绿：`test-results/phase4-final3.log`（87/87）
- 类型检查：`test-results/phase4-final3-typecheck.log`
- 构建与目录版打包：`test-results/phase4-final-dist.log`
- 端到端：`test-results/phase4-final-e2e.log`

### 未执行 / 尚未验证

- 原生关闭确认对话框未做真实点击自动化；关闭保护逻辑有单元测试，主窗口已接线。
- “打开文件”真正拉起默认播放器、“打开日志目录”真正拉起资源管理器未反复自动化执行；IPC 拒绝路径和输出存在性已验证。
- 真实拖拽只做了单文件；多文件路径数组与数量校验由单元测试覆盖。
- 整体视觉重做、组件库选型和设计稿对比留到开发者回来之后。
- 转换设置持久化、完成通知、字幕轨和硬件加速仍未实现。
- AOCI 完整索引仍为 0 条 Entry；阶段 4 没有在空索引上强行生成批量语义。

### 当前状态

- 阶段 4 功能型 UX 已完成并停止，等待开发者检查。
- 下一步由开发者确定视觉方向和组件库，再决定是否先做视觉重做，或直接进入阶段 5 交付加固。

---

## 2026-10-21｜阶段 4 后：P0/P1 交付范围确认（规划，未实施）

### 开发者决策

- 目标不只是通过笔试题，也希望把 FrameForge 做成一个可以公开的 GitHub 项目。
- Mac 只预留架构，不在当前阶段承诺 `.dmg`、签名或正式交付。
- 当前优先级调整为：先把 Windows 交付链打通，再做格式和高级能力。
- 功能优先级确认为：
  - P0：FFmpeg 随包、Windows 安装包/便携包、干净机器 E2E、移除主界面环境面板、测试计划/会话总结/README/GitHub 发布；
  - P1：WebM（VP9 + Opus）、仅音频 MP3、高级设置（分辨率/音频码率/CRF/只读命令预览）、动态剩余时间、完成提示音（可选）、输出设置持久化（可选）。
- 明确延后：Mac 正式交付、开关动画、应用内播放输出、GIF/MOV/H.265、试转预览、硬件编码矩阵、任意 FFmpeg 命令输入、队列暂停/重排。
- 执行顺序原则：先选 FFmpeg 构建并打通最小交付基线，再做格式能力层和 WebM/MP3，再做高级设置与 ETA，最后做视觉、最终安装包、干净机器验收和文档/Git。

### 本轮实际修改

- 新增 `docs/DELIVERY_PLAN.md`，记录 P0/P1 范围、里程碑顺序、验收标准、风险和执行状态。
- README 增加交付计划入口。
- 本开发日志增加本次范围确认记录。
- 建立首个 Git 基线提交 `87d5395`，推送到 GitHub `origin/main`。
- 本轮没有修改业务代码，没有运行新的功能测试；现有阶段 4 结果仍然有效。

### 当前风险

- FFmpeg 随包构建和许可证尚未确定；在确认前不能宣称安装包可公开分发。
- 已建立首个基线提交 `87d5395` 并推送到 `origin/main`；最终 GitHub 交付前仍需清理并继续按里程碑提交。
- P1 的格式/参数组合会扩大测试矩阵，必须以能力探测和真实转换测试控制范围。
- Mac 只保留架构，不能把“代码使用跨平台 API”写成“Mac 已验证”。

### 下一步

- 先执行 M0/M1：冻结契约，选择 FFmpeg 构建，完成随包、安装包打样和主界面环境面板清理。
- M1 通过后再进入 M2（格式能力层、WebM、MP3）。
- 详细顺序和验收标准以 `docs/DELIVERY_PLAN.md` 为准。


---

## 2026-10-21｜M1：Windows 最小可交付基线

### 本轮目标

- 把 FFmpeg/FFprobe 真正放进 Windows 安装包；
- 保留旧的 flat 资源目录兼容，新增 `<platform>-<arch>` 布局；
- 移除主界面开发者环境面板，但保留 FFmpeg 缺失错误和恢复入口；
- 生成 NSIS 安装包和完整目录 zip；
- 在移除系统 PATH 和 FFmpeg 覆盖环境变量的条件下做真实 E2E；
- 保持“主函数只调用”的编排风格。

### 真实 RED

先新增 `test/phase-05-delivery.test.tsx`，覆盖：

- 打包/开发模式的 `resources/ffmpeg/<platform>-<arch>` 解析；
- 旧 flat 目录回退；
- `package.json` 的 FFmpeg extraResources、NSIS 和 zip 目标；
- 主界面不再出现“运行环境 / Node.js / FFmpeg 路径”；
- FFmpeg 缺失时显示“视频引擎未就绪”、重新检测和日志入口；
- 缺失错误不要求普通用户自己安装 FFmpeg。

执行：

```text
npx vitest run test/phase-05-delivery.test.tsx
6 failed / 6
```

RED 记录：`test-results/phase5-delivery-red.log`。

### 实现

1. 新增 `electron/main/services/ffmpeg/layout.ts`
   - `getPlatformArchDirectoryName()`；
   - `getBundledFfmpegDirectories()`：先 `<platform>-<arch>`，再旧 flat 目录；
   - 去重，避免打包模式下重复检查同一路径。

2. 更新 `resolver.ts`
   - 支持 `arch` 参数；
   - 随包候选全部走 layout；
   - 环境变量仍最优先，系统 PATH 最后。

3. 新增 `scripts/prepare-ffmpeg.mjs`
   - 支持 `FRAMEFORGE_FFMPEG_SOURCE` / `FRAMEFORGE_FFMPEG_DIR` / 系统 PATH；
   - 复制 exe、全部 Windows DLL、LICENSE、README；
   - 通过 `spawn(executable, ['-version'], { shell: false })` 真实验证；
   - 写入 `bundle-manifest.json`。

4. 打包配置
   - `extraResources` 复制 `resources/ffmpeg` → `resources/ffmpeg`；
   - Windows 目标：NSIS + zip；
   - 自定义 `build/icon.ico`；
   - 新增 `npm run prepare:ffmpeg`、`npm run e2e:packaged`。

5. 主界面
   - 删除 `EnvironmentPanel`；
   - 新增 `FfmpegErrorBanner`，提供“重新检测”和“打开日志目录”；
   - 底栏保留“打开日志目录”入口；
   - `App` 的 FFmpeg 状态映射提取为 `toFfmpegState()`。

### 测试与构建结果

```text
npx vitest run test/phase-05-delivery.test.tsx   6/6 通过
npm test                                          5 个文件，93/93 通过
npm run typecheck                                 通过
npm run dist:dir                                  成功
npm run dist:win                                  成功
```

产物：

```text
release/FrameForge Setup 0.1.0.exe   167 MB
release/FrameForge-0.1.0-win.zip     230.6 MB
release/win-unpacked/                目录版
```

### 无 PATH 打包版 E2E

执行：

```text
npm run e2e:packaged
```

启动参数中移除 `PATH`、`FRAMEFORGE_FFMPEG_DIR`、`FRAMEFORGE_FFMPEG_SOURCE`，真实结果：

```text
source: bundled
ffmpeg: 8.0.1
ffmpegPath: release/win-unpacked/resources/ffmpeg/win32-x64/ffmpeg.exe
importMode: drag-drop
输入: 阶段五 真实 视频.mp4（640×360，2000ms）
输出: 阶段五 真实 视频_converted.mp4，49,555 字节
输出探测: H.264 640×360
```

截图：`docs/evidence/phase5-packaged.png`。

### 安装包 smoke test

- NSIS 静默安装到 `test-results/phase5-install/FrameForge`，安装器退出码 0；
- 安装目录包含 `resources/ffmpeg/win32-x64/ffmpeg.exe`、`ffprobe.exe`、全部 DLL、LICENSE 和 manifest；
- 对安装版执行同一套无 PATH E2E，结果为 `source: bundled`，真实输出 H.264 640×360；
- 截图：`docs/evidence/phase5-installed.png`。

### 遇到的问题

- `prepare-ffmpeg.mjs` 首次运行缺少 `stripQuotes` 定义；补上后重新执行成功。
- 去掉环境面板后，底栏和 FFmpeg 错误面板都可能出现“打开日志目录”；阶段 5 UI 测试改为在 `role="alert"` 范围内查找，避免多匹配。
- 旧阶段 1/2/4 测试仍断言环境面板或旧错误文案，已按新交付行为更新，不保留“测试通过但界面仍展示开发者信息”的假绿。

### 文档

- 新增 `docs/TEST_PLAN.md`；
- 新增 `THIRD_PARTY_NOTICES.md`；
- 重写 `docs/FFMPEG.md`；
- 更新 `README.md`、`docs/DELIVERY_PLAN.md` 状态板；
- 记录真实证据日志：`test-results/phase5-*`。

### 完整目录 zip 与卸载

- 把 `release/FrameForge-0.1.0-win.zip` 解压到 `test-results/phase5-zip/`；
- 确认 zip 内包含 `FrameForge.exe`、`resources/ffmpeg/win32-x64/ffmpeg.exe`、`ffprobe.exe`、`bundle-manifest.json` 和 `THIRD_PARTY_NOTICES.md`；
- 对解压版执行同一套无 PATH E2E，结果 `source: bundled`，真实输出 H.264 640×360；
- 截图：`docs/evidence/phase5-zip.png`；
- 重新安装最终安装包到新目录，确认 `resources/THIRD_PARTY_NOTICES.md` 存在，并再次通过无 PATH E2E；
- 执行 `Uninstall FrameForge.exe /S`，退出码 0，安装目录被清理；日志：`test-results/phase5-e2e-zip.log`、`test-results/phase5-e2e-installed-final.log`、`test-results/phase5-uninstall.log`。

### 未完成 / 风险

- 独立干净 Windows VM 的安装、取消、打开输出、卸载验收仍需 M6 完成；
- 安装包未签名，可能出现 SmartScreen 提示；
- FFmpeg 为 GPLv3 shared build，已保留许可证和源码获取说明，但正式发布前仍需维护者确认合规；
- M2 格式能力层尚未开始（本节写于 M1 收尾时，下一节记录 M2 实际结果）。

---

## 2026-10-22 / M2：格式能力层 + WebM/MP3

### 目标

把 MP4/MKV 扩展为 MP4/MKV/WebM/MP3，同时不产生“UI 显示支持、实际编码器缺失”的假支持。

### 测试先行

新增 `test/phase-06-formats.test.tsx`，先取得真实 RED，再实现：

- `OutputProfile` 格式矩阵、扩展名、编码器需求；
- 真实 `ffmpeg -hide_banner -encoders` 输出解析；
- 能力缺失时格式禁用和原因；
- WebM 参数：`libvpx-vp9`、`libopus`、`-b:v 0`、无音轨 `-an`；
- MP3 参数：`-vn`、`0:a:0`、`libmp3lame`；
- MP3 无音轨入队拒绝；
- 真实 WebM/MP3 输出和 FFprobe 编码验证；
- 输出 profile 校验；
- 格式选择 UI 的编码摘要、缺失编码器原因、音频-only 说明。

RED 证据：`test-results/phase6-formats-red.log`、`phase6-formats-red2.log`。

### 实现

1. 共享契约
   - `shared/conversion.ts`：`OUTPUT_PROFILES` 统一描述容器、扩展名、编码器、摘要和说明；新增 `isAudioOnlyFormat()`。
   - `shared/capabilities.ts`：编码器 ID、能力矩阵、`parseEncoderList()`、`buildConversionCapabilities()`。

2. 主进程
   - `electron/main/services/ffmpeg/capabilities.ts`：真实执行 `ffmpeg -encoders`，缓存成功结果；失败返回全 false 和错误，不伪装可用。
   - `conversion/args.ts`：由 profile 驱动参数，MP4 faststart 只出现在 MP4；WebM 使用 VP9 CRF + `-b:v 0`；MP3 不构造视频参数。
   - `conversion/queue.ts`：`validateSource()` 接收设置；仅音频格式用真实 FFprobe 探测 `hasAudio`，无音轨在入队阶段失败，不启动 FFmpeg。
   - `conversion/runner.ts`：成功后调用 `probeOutputFile()`，校验容器、视频/音频编码、轨道存在性和时长；不一致时删除最终输出并标记失败。
   - `media/probe.ts`：新增 `probeOutputFile()` / `parseOutputProbeJson()`，允许音频输出但不允许空容器。

3. IPC / renderer
   - 新增 `conversion:get-capabilities` 通道、preload 方法和 `DesktopAPI.getConversionCapabilities()`。
   - `App.tsx`：启动时读取能力；不可用格式自动回退；MP3 过滤无音轨项目并显示排除数量；重新检测 FFmpeg 后刷新能力。
   - `ConversionSettings.tsx`：显示容器/编码摘要、不可用原因、检测中/失败状态；MP3 显示“音频质量”和“仅导出音频”，隐藏视频质量说明。

### 测试与构建结果

```text
npx vitest run test/phase-06-formats.test.tsx   19/19 通过（含 4 个真实 FFmpeg 用例）
npm test                                         6 个文件，112/112 通过，无 skip
npm run typecheck                                通过
npm run build                                    main / preload / renderer 构建通过
npm run dist:dir                                 win-unpacked 构建成功
```

真实集成结果：

```text
WebM: VP9 320×240 + Opus，completed，输出存在
MP3:  MP3 音频，无视频轨道，completed
无音轨 MP4 → MP3: failed，错误包含“没有音轨”，未启动 FFmpeg
```

### 打包版无 PATH E2E

脚本改为依次验证 MP4/WebM/MP3，并读取能力矩阵。真实结果：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpeg: 8.0.1
MP4:  49,555 字节，H.264 640×360 + AAC
WebM: 73,708 字节，VP9 640×360 + Opus
MP3:  67,019 字节，MP3 音频，无视频轨道
能力: libx264 / aac / libvpx-vp9 / libopus / libmp3lame 全部 true
```

截图：

- `docs/evidence/phase6-formats.png`
- `docs/evidence/phase6-mp3.png`

日志：`test-results/phase6-e2e-formats-final.log`、`phase6-dist-dir-final.log`、`phase6-full-suite-final2.log`、`phase6-typecheck-final2.log`。

### 遇到的问题

- WebM UI 测试最初在默认 MP4 选中态查找 `VP9 + Opus`，与实际“只显示当前格式摘要”不符；拆成选中 WebM 的独立用例。
- MP3 是音频文件，原有 `probeMedia()` 只接受视频扩展名；新增 `probeOutputFile()`，保留导入阶段视频白名单，同时允许输出验证读取 `.mp3`。
- 输出验证最初只检查非空；补充 FFprobe 编码/轨道校验，避免“文件非空但编码错误”被标记完成。
- 全量测试有两个旧 preload 契约断言缺少新键；更新为包含 `getConversionCapabilities`，没有删除契约检查。
- M2 只重建了 `win-unpacked`；安装包和 zip 仍是 M1 基线，M6 功能冻结后统一重建。

### 未完成 / 风险

- M4/M5 等 M2/M3 验收后再确定；
- 安装包/zip 尚未包含 M2 功能；
- GPL 合规、代码签名、独立干净 VM 验收仍在 M6 前处理；
- AOCI 完整索引仍为 0 条 Entry，本轮未在空索引上强行生成语义。

---

## 2026-10-22 / M3：高级设置 + 命令预览 + 动态 ETA

### 目标

在稳定格式链路之上增加可调试性，但不破坏普通用户主流程：

- 分辨率、CRF、音频码率、音频模式可调；
- 命令预览与实际执行共用同一份参数；
- ETA 只来自真实 FFmpeg `speed`，不伪造倒计时；
- 所有高级输入由主进程校验。

### 测试先行

新增 `test/phase-07-advanced.test.tsx`，覆盖 12 个用例：

- 720p 缩放参数、原始分辨率无 `-vf`、小源视频不放大；
- 自定义 CRF、音频码率、移除音轨；
- MP3 禁止移除音轨；
- 命令预览包含同一组参数和带空格路径；
- 主进程拒绝 CRF 越界、非法音频码率、非法分辨率/音频模式；
- `speed` 解析、5 样本平滑、不足两个样本无 ETA；
- 队列 telemetry 和完成后清除 ETA；
- 高级面板默认折叠、修改回调和复制命令；
- 任务 UI 已用/剩余/速度；
- App 把界面高级设置原样提交给主进程；
- 真实 1280×720 → 480p、CRF 18、移除音轨。

真实 RED：`test-results/phase7-advanced-red.log`，首次运行因 `shared/conversion-args` 尚不存在而失败。实现后仍有 3 个失败，分别暴露：参数构造未在 builder 内处理 `audioMode=remove`、队列首个 running 快照没有 telemetry、真实测试误读了入队时的旧任务快照；修正后 GREEN 记录在 `test-results/phase7-advanced-green.log`。

### 实现

1. 共享契约
   - `shared/conversion.ts`：高级设置模型、默认值、分辨率/音频码率/音频模式/CRF 校验辅助、预览输出路径；
   - `shared/conversion-args.ts`：唯一参数构造和 `formatCommandForDisplay()`；主进程 `conversion/args.ts` 只重新导出，renderer 预览调用同一函数。

2. 主进程
   - `conversion/validation.ts`：解析并校验高级设置；MP3 的 `audioMode=remove` 直接拒绝；
   - `conversion/queue.ts`：`assertSettings()` 二次校验；任务增加 `elapsedMs` / `speed` / `etaSeconds`；完成、取消、失败后清除过期 ETA；
   - `conversion/progress.ts`：解析真实 `speed=1.23x`，最近 5 个样本平均；不足两个样本保持 null；每个 progress tick 发送 telemetry；
   - `conversion/runner.ts`：探测源宽高；把分辨率、CRF、音频码率和音频模式传给参数构造；移除音轨时输出验证按“期望无音频”检查。

3. renderer
   - `src/components/AdvancedSettings.tsx`：默认折叠、分辨率/CRF/音频码率/音频模式、只读命令预览、复制命令；
   - `src/App.tsx`：高级状态、预览源和真实 FFmpeg 路径、复制 IPC、切换 MP3 时强制保留音轨；
   - `src/components/JobQueue.tsx`：显示真实“已用 / 剩余 / 速度”，未知时显示“估算中”。

### 测试与构建结果

```text
npx vitest run test/phase-07-advanced.test.tsx   12/12 通过（含 1 个真实转换）
npm test                                         7 个文件，124/124 通过，无 skip
npm run typecheck                                通过
npm run build                                    main / preload / renderer 构建通过
npm run dist:dir                                 win-unpacked 构建成功
```

真实高级转换：

```text
输入: 1280×720，5 秒，带音频
设置: 480p + CRF 18 + 移除音轨
输出: H.264 854×480，无音频，45,186 字节（打包版 E2E）
ETA: 真实转换中捕获 speed > 0 且 etaSeconds 非空
```

### 打包版无 PATH E2E

`scripts/e2e-packaged.mjs` 在原有 MP4/WebM/MP3 基础上新增：

- 1280×720 高级输入；
- 高级 MP4 转换（480p、CRF 18、移除音轨）；
- FFprobe 断言 854×480 且无音频；
- 真实 UI 打开高级面板、选择 480p、等待命令预览，并保存截图。

结果：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpeg: 8.0.1
高级 MP4: 45,186 字节，H.264 854×480，无音频
截图: docs/evidence/phase7-advanced.png
```

### 遇到的问题

- 参数构造最初只信任调用方传入的 `hasAudio`，直接调用 builder 时 `audioMode=remove` 没有生成 `-an`；改为在 builder 内统一计算 `keepAudio`。
- 队列测试用 `find(status === 'running')` 取到了开始时的空 telemetry 快照；改为查找带真实 speed 的 running 更新。
- 真实转换测试在 `waitForIdle()` 后读取入队返回的旧对象，状态仍是 queued；改为从队列重新取任务。
- 命令预览需要渲染端可用的纯函数，因此把参数构造移到 `shared/`；主进程保留 re-export，避免测试和调用方大改。
- E2E 首版高级截图被内部滚动容器裁掉命令预览；通过 CDP 临时提高视口高度后重新截取。
- M3 只重建了 `win-unpacked`；安装包和 zip 仍是 M1 基线，M6 功能冻结后统一重建。

### 未完成 / 风险

- 按约定停在 M2/M3，等开发者验收真实行为、UI 和证据；
- M4 完成提示音、输出设置持久化；M5 视觉方向待开发者给参考后调整；
- 安装包/zip 尚未包含 M2/M3 功能；
- 代码签名、GPL 合规、独立干净 VM 验收仍在 M6 前处理；
- AOCI 完整索引仍为 0 条 Entry，本轮未在空索引上强行生成语义。

---

## 2026-10-22 / M4：转换历史 + 默认输出目录 + 命令预览折叠

### 目标

在不改变转换真实性的前提下补齐开发者要求的 M4：

- 高级设置里的 FFmpeg 命令预览增加独立展开/折叠；
- 右侧栏增加完成/失败/取消历史，重启后恢复，最多 200 条；
- 清空历史只删记录，不删输出文件；
- 首次导入后默认使用首个有效源文件目录，手动选择后不被覆盖；
- 历史只能由主进程写，renderer 不接触文件系统；
- 历史动作使用独立历史 ID，不复用重启后的队列任务 ID。

### 测试先行

新增 `test/phase-08-history.test.tsx`，RED 记录在 `test-results/phase8-history-red.log`。首次运行的真实失败是：

```text
Failed to resolve import "../src/components/HistoryCard" from "test/phase-08-history.test.tsx"
```

实现后聚焦测试仍有 3 个失败，分别暴露：

- 历史记录断言假设了任务 ID 顺序，但校验失败记录会在首个完成记录之前写入；
- “打开文件”按钮的 accessible name 同时匹配“打开文件夹”，需要精确名称；
- 历史筛选按钮“失败/取消”和任务队列状态文本重名，需要限定到右侧栏或任务队列。

修正后 `test-results/phase8-history-green.log` 记录 13 个用例通过。随后补测“前 5 条 + 展开全部/收起”和“取消运行中任务只通知一次”，M4 用例变为 14 个。

全量回归时出现 8 个旧阶段失败：

- phase-01 两个 App stub 没有新历史方法；
- phase-03/04 的 `DESKTOP_API_KEYS` 精确数组缺少 5 个历史键；
- phase-03 仍断言“未选择输出目录”，与新默认源目录冲突；
- phase-03/04 的“失败/取消”文本同时匹配历史筛选按钮。

处理方式是补 API stub、更新契约数组、把默认目录断言改为源目录，并把状态文本断言限定到 `任务队列` region；没有删除契约检查。

### 实现

1. 共享契约
   - `shared/history.ts`：历史记录类型、终态集合、`MAX_CONVERSION_HISTORY_ENTRIES=200`、按时间倒序/ID 去重/截断的 `mergeHistoryEntries()`；
   - `shared/path.ts`：`getParentDirectory()` 和 `getFileName()`，供默认目录与历史标题使用；
   - `shared/ipc.ts`：5 个历史通道、`DesktopAPI` 方法、`DESKTOP_API_KEYS`。

2. 主进程
   - `electron/main/services/history/store.ts`：注入文件系统依赖的 `ConversionHistoryStore`；`record()` 只接受终态、按 job ID 去重、原子临时文件 + rename、损坏 JSON 备份、最近 200 条；`list()` 重新检查完成输出是否存在；`clear()` 只清记录；
   - `conversion/queue.ts`：新增 `onTerminal` 回调和 `terminalNotified` 集合；完成、失败、取消（含排队取消和运行中 abort）只通知一次，并携带入队时设置；
   - `ipc/handlers.ts`：构造 store，终态写入后推送 `history:updated`；历史读取、清空、打开文件/文件夹走独立 IPC，打开动作先按历史 ID 取真实记录并检查输出存在。

3. preload / renderer
   - `electron/preload/api.ts`：历史读取/清空/订阅/打开方法，订阅返回取消函数；
   - `src/components/HistoryCard.tsx`：右侧栏历史卡片，默认 5 条、展开全部、筛选、缺失输出禁用、复制错误、二次确认清空；
   - `src/components/AdvancedSettings.tsx`：高级面板内部的命令预览独立折叠，默认展开；
   - `src/components/ConversionSettings.tsx`：输出目录 `data-testid` 和“默认源目录”提示；
   - `src/App.tsx`：首次有效导入自动填源目录、历史首屏读取、历史事件订阅、并发合并、清空/打开动作接线。

### 测试与构建结果

```text
npx vitest run test/phase-08-history.test.tsx   14/14 通过
npm test                                         8 个文件，138/138 通过，无 skip
npm run typecheck                                通过
npm run dist:dir                                 win-unpacked 构建成功
```

### 打包版无 PATH E2E

`scripts/e2e-packaged.mjs` 新增：

- 拖拽导入后断言输出目录等于源文件目录；
- 4 次真实转换后，历史 API 返回 4 条 completed；
- 关闭应用后读取 `conversion-history.json`，确认 4 条落盘；
- 同一 userData 重启，历史卡片恢复 4 条，保存 `phase8-history.png`；
- 在高级设置中折叠/展开命令预览；
- 通过界面二次确认清空历史，确认列表 0 条、4 个输出文件仍在。

真实结果：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
默认输出目录: ...\test-results\phase5-e2e\输入 样本
历史: initial 0 → 4 completed → persisted 4 → reloaded 4 → cleared 0
清空后输出: 4/4 存在
截图: docs/evidence/phase8-history.png
日志: test-results/phase8-e2e.log
```

### 遇到的问题

- 历史筛选按钮“失败/取消”与任务状态文本同名，Testing Library 的全局 `getByText` 会命中两个节点；改为 `within(任务队列 region)`。
- 历史卡片的“打开文件夹”文本也包含“打开文件”，按钮查询必须用精确名称 “打开文件”。
- E2E 直接调用 `clearConversionHistory()` 只清主进程，不会更新已经渲染的 UI；改为真实点击“清空”→“确认清空”，同时验证前后端。
- App 启动读取历史与主进程推送终态可能并发；如果加载结果直接覆盖 state，会丢掉先到的新记录；改为逐条 `mergeHistoryEntries()`。
- E2E 原等待文本“命令预览（只读）”已被新的“FFmpeg 命令预览”标题取代；同步更新等待条件。
- 历史截图选择在重启后截取，画面中没有导入媒体，但能直接证明历史从 `userData` 恢复；这是有意的证据取舍。

### 未完成 / 风险

- M5 视觉方向等待开发者参考；M6 重建安装包/zip 并做独立干净 VM 验收；
- 完成提示音、格式/质量/高级设置持久化仍是可选 P1；
- 当前 `release/win-unpacked` 已包含 M4；安装包和 zip 仍是 M1 基线；
- 代码签名、GPL 合规法律确认、独立干净 VM 仍未完成；
- AOCI 完整索引仍为 0 条 Entry，本轮未在空索引上强行生成语义。

---

## 2026-10-22 / M4 补丁：工作区移除

### 问题

开发者反馈：视频加入工作区后只能继续添加，无法移除已导入项。

### 测试先行

在 `test/phase-04-polish.test.tsx` 增加 2 个用例：

- 导入两项后逐项移除，计数从 2 → 1 → 空状态；
- 转换进行中（running）禁用移除按钮并显示原因。

RED：`test-results/phase9-workspace-remove-red.log`，真实失败为找不到 `从工作区移除 测试 视频.mp4` 按钮。

### 实现

- `MediaCard`：状态徽标旁增加“移除”按钮，aria-label 为 `从工作区移除 <文件名>`；
- `MediaList`：接收移除回调和活跃源路径集合；
- `App`：`activeSourcePaths` 从 queued/running 任务派生；移除只更新 `items`，不调用文件删除 API；有活跃任务时忽略移除；
- 移除最后一项后自动回到空状态，重新导入仍可恢复。

### 结果

```text
npx vitest run test/phase-04-polish.test.tsx   16/16 通过
npm test                                        8 个文件，140/140 通过，无 skip
npm run typecheck                              通过
```

GREEN：`test-results/phase9-workspace-remove-green.log`，全量：`test-results/phase9-full-suite.log`。

---

## 2026-10-22 / M5 前置：全局动态点阵背景

### 需求

开发者提供 `docs/UI.md`，要求先把整个应用背景替换为其中的 `CanvasFractalGrid`。

### 实现

- 新增 `src/components/background/CanvasFractalGrid.tsx`，保留点阵、鼠标波形/光晕、渐变呼吸、噪声和 FPS 自适应逻辑；
- 深色主题适配：canvas 使用 `mix-blend-mode: screen`，去掉原组件的浅灰底色；渐变透明度 0.26，避免盖住正文；
- 点阵颜色使用 indigo，鼠标光晕使用蓝色；背景容器 `pointer-events-none`，不拦截点击/拖拽；
- `AppShell` 用该组件替换原来的静态径向渐变，header/footer/内容布局不变；
- 新增依赖 `motion@12`。

### 验证

```text
npm run typecheck                    通过
npm test                             8 个文件，140/140 通过，无 skip
npm run build                        main / preload / renderer 构建通过
打包版 E2E                           4 个真实转换、历史持久化/恢复/清空通过
CDP 手工检查                         renderer exceptions=0；高级设置真实展开
```

截图已更新：`docs/evidence/phase6-formats.png`、`phase6-mp3.png`、`phase7-advanced.png`、`phase8-history.png`。

### 过程中的真实问题

- E2E 一次在“高级设置”处超时；独立 CDP 会话证明点击、展开和命令预览都正常，renderer 无异常。原因是选择 MP4 后立即点击高级设置存在时序抖动；E2E 在点击前增加“等待 MP4 格式摘要”，再次完整运行通过。
- 当前机器执行默认 `npm run dist:dir` 时，electron-builder 解压 Electron 后 rename `win-unpacked.tmp` 报 EPERM；使用 `--config.electronDist=node_modules/electron/dist` 完成打包。该问题是本机文件锁/安全软件层面的构建环境问题，不是应用逻辑；M6 重建安装包时需再次确认。
