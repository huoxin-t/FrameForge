# 如何使用

1.在release下载安装包或直接解压版。

2.pull到本地后，可安装相关依赖进行打包。
```
npm run dist:win
```
# B站展示




----
# FrameForge（帧铸）

本地视频格式转换桌面客户端。用 Electron + React + TypeScript 调用真实的 `ffmpeg` / `ffprobe`，完成视频导入、媒体信息读取、缩略图、格式转换和串行任务队列。

> 当前进度：**M4（转换历史 + 默认输出目录 + 命令预览折叠）已完成**。
> M1 安装包已内置 FFmpeg/FFprobe；M2 增加真实编码器探测、WebM（VP9 + Opus）和仅音频 MP3；M3 增加高级设置、与执行共用参数构造的命令预览，以及来自真实 `speed` 的动态 ETA；M4 增加右侧栏持久化转换历史、首次导入自动使用源文件目录，以及命令预览独立展开/折叠。
> 视觉重做 M5 和最终安装包/Release 的 M6 仍待继续。完整计划见 [docs/DELIVERY_PLAN.md](docs/DELIVERY_PLAN.md)。

![FrameForge 打包版工作台](docs/evidence/phase6-formats.png)

> 想从代码层面理解项目，先读 [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)：按“导入 → 探测 → 缩略图 → 转换 → 队列 → UI”讲清真实调用链、安全边界和测试方式。

## 现在能做什么

- 通过系统文件选择器或拖拽导入本地视频；支持一次多个文件、中文/空格路径。
- 全局使用 canvas 动态点阵与渐变背景；鼠标移动产生波光，背景层不拦截任何点击或拖拽。
- 顶部 header 使用半透明深色底、24px 背景模糊、亮度/饱和度提升和 SVG 噪声位移玻璃纹理；玻璃层为 `pointer-events-none`。
- 用真实 `ffprobe` 读取时长、分辨率、帧率、容器、视频/音频编码和文件大小。
- 用真实 `ffmpeg` 抽取缩略图；缩略图失败只显示占位图，不阻塞文件转换。
- 输出 MP4 / MKV（H.264 + AAC）、WebM（VP9 + Opus）和仅音频 MP3；提供兼容优先、质量优先、体积优先三个质量预设。
- 启动时真实执行 `ffmpeg -hide_banner -encoders`，只把当前构建真正拥有的编码器显示为可用；缺失时禁用格式并说明原因。
- MP3 只导出音频；无音轨视频在入队阶段被拒绝。WebM 无音轨输入使用 `-an`，不会凭空生成音轨。
- 高级设置默认折叠：分辨率（原始/1080p/720p/480p，不放大、偶数宽度）、CRF 18–30、音频码率 128/192/256 kbps、保留/移除音频。
- 只读命令预览与实际执行共用 `buildConversionArgs()`，支持复制；命令预览在高级设置内部还有独立的展开/折叠开关；renderer 不能传任意 FFmpeg 参数。
- 首次导入后默认把首个有效源文件所在目录作为输出目录；用户手动选择后不会被后续导入覆盖。
- 工作区媒体卡片支持逐项移除；转换进行中的文件会禁用移除，移除只影响工作区列表，不会删除原文件。
- 右侧栏保留完成、失败和取消的转换历史，启动时从主进程 `userData` 下的 JSON 恢复，最多 200 条；支持筛选、打开输出、复制错误和二次确认清空。清空历史不删除输出文件。
- 动态 ETA 只使用真实 `speed`；最近 5 个样本平滑，不足两个样本显示“估算中”，任务完成/取消后清除。
- 任务队列支持终态任务单独删除和批量清空；运行中任务只能取消，清空不会删除输出文件或历史记录。
- 串行任务队列：失败/取消不会阻塞后续任务；取消会终止真实子进程并清理临时文件。
- 进度来自 FFmpeg `-progress pipe:1`，成功前最多 99%；完成状态必须经过退出码、临时文件、最终文件非空和 FFprobe 容器/编码/轨道校验。
- 输出名冲突自动生成 `_converted (1)`、`_converted (2)`，不覆盖已有文件。
- 完成任务可打开文件或所在目录；失败任务可复制错误并打开日志目录。
- Windows 安装包和完整目录 zip 均已生成；安装包内置 FFmpeg/FFprobe 和许可证文件。当前安装包和 zip 是 M1 基线；M2/M3/M4 功能已在重新构建的 `win-unpacked` 验证，最终安装包/zip 在 M6 统一重建。

界面不会用定时器伪造进度，也不会在失败时假装生成输出文件。

## 技术栈

- Electron 45 + electron-vite 6
- React 19 + TypeScript 5.9
- Vite 8 + Tailwind CSS 4
- motion 12（动态点阵背景）
- Vitest 5 + Testing Library
- electron-builder 26（Windows NSIS + zip）

## 直接使用构建产物

当前仓库的 `release/` 下会有：

```text
release/FrameForge Setup 0.1.0.exe   # NSIS 安装包
release/FrameForge-0.1.0-win.zip     # 完整目录 zip，解压即用
release/win-unpacked/                # 免安装目录版
```

安装包和 zip 当前**未配置代码签名**，Windows SmartScreen 可能提示未知发布者。正式 GitHub Release 在 M6 整理后发布。

安装后不需要预装 FFmpeg、Node.js 或 Electron。

## 从源码运行

### 环境要求

- Windows 10/11 x64
- Node.js >= 22.12
- npm >= 10
- 准备随包 FFmpeg 时需要本机有一份 FFmpeg/FFprobe（仅构建机需要，最终用户不需要）：
  - 推荐把 FFmpeg 加入 `PATH`；或
  - 用 `FRAMEFORGE_FFMPEG_SOURCE` 指向同时包含 `ffmpeg` 和 `ffprobe` 的目录。

```bash
npm install
npm run prepare:ffmpeg
npm run dev
```

`resources/ffmpeg/` 不提交 Git，已加入 `.gitignore`。准备脚本会复制 exe、Windows 依赖 DLL、许可证，并真实执行 `-version` 验证。

### 常用命令

```bash
npm run dev             # 启动 Electron 开发模式
npm test                # Vitest；真实 FFmpeg 集成用例会实际启动 ffmpeg/ffprobe
npm run typecheck       # TypeScript 类型检查
npm run build           # 构建 main / preload / renderer 到 out/
npm run prepare:ffmpeg  # 准备 resources/ffmpeg/<platform>-<arch>/
npm run dist:dir        # 构建免安装目录版 release/win-unpacked/
npm run dist:win        # 构建 NSIS 安装包 + 完整目录 zip
npm run e2e:packaged    # 对打包版做无 PATH 的真实 CDP E2E
```

安装包 smoke test：

```powershell
Start-Process "release\FrameForge Setup 0.1.0.exe" `
  -ArgumentList "/S", "/D=D:\path\to\FrameForge" -Wait
```

## 目录结构

```text
electron/
  main/
    index.ts                    # main() 只做依赖装配和启动编排
    orchestrator.ts             # 可测试的启动顺序
    window-options.ts           # 窗口安全配置
    security.ts                 # 禁止外部导航与新窗口
    ipc/
      handlers.ts               # 受控 IPC：应用信息 / 导入 / 转换 / 历史 / 打开 / 复制 / 日志
      guard.ts                  # IPC 调用方校验
    services/
      close-guard.ts             # 关闭窗口前的任务确认、取消和等待
      logger.ts                 # electron-log 配置
      logger-core.ts            # 可测试的命名 logger
      app-info.ts               # 运行环境信息
      ffmpeg/
        layout.ts               # resources/ffmpeg/<platform>-<arch> 布局
        process.ts              # spawn(executable, args, { shell: false }) 封装
        capabilities.ts         # 真实执行 ffmpeg -encoders，缓存能力矩阵
        resolver.ts             # 环境变量 / 随包目录 / 系统 PATH 解析
        status.ts               # 真实执行 -version 并缓存状态
      media/
        probe.ts                # 路径校验、ffprobe JSON 解析、真实探测
        thumbnail.ts            # 真实 ffmpeg 单帧抽取为 320×180 JPEG
        media-service.ts        # 逐文件编排与缩略图降级
        import-validation.ts    # 拖拽导入路径、扩展名和数量校验
      conversion/
        args.ts                 # profile 驱动的 MP4/MKV/WebM/MP3 参数
        output.ts               # _converted 命名、冲突避让、目录校验、临时文件
        output-actions.ts       # 校验已完成任务并打开文件/所在目录
        progress.ts             # 进度行解析和 0–99% 上限
        runner.ts               # 真实转换、输出验证、临时文件清理
        queue.ts                # 串行队列、状态机、失败隔离、取消
        validation.ts           # IPC 输入、任务 ID、剪贴板文本验证
      history/
        store.ts                # 终态历史 JSON：原子写入、校验、损坏备份、最近 200 条
      system/
        open-path.ts            # 只打开主进程确认存在的目录
        path-exists.ts          # 受控路径存在性检查
  preload/
    index.ts                    # contextBridge 最小暴露面
    api.ts                      # 可测试的 DesktopAPI 工厂
shared/
  ipc.ts                        # 主进程 / preload / renderer 共享 IPC 契约
  conversion.ts                 # 格式 profile、质量预设、高级设置、任务状态、进度事件类型
  conversion-args.ts            # 执行与命令预览共用的 FFmpeg 参数构造
  history.ts                    # 历史记录类型、合并去重和 200 条上限
  path.ts                       # 跨平台父目录 / 文件名辅助
  capabilities.ts               # 编码器能力矩阵与格式可用性
  media.ts                      # 媒体、缩略图、FFmpeg 状态类型
  media-format.ts               # 时长 / 帧率 / 大小 / 分辨率格式化
src/
  App.tsx                       # 导入、输出设置、高级设置、队列/历史订阅和任务状态
  components/                   # AppShell / HeaderGlass / FfmpegErrorBanner / EmptyState / MediaCard / MediaList / ConversionSettings / AdvancedSettings / JobQueue / HistoryCard
  components/background/        # CanvasFractalGrid 动态点阵/渐变背景
scripts/
  prepare-ffmpeg.mjs            # 复制并真实验证随包 FFmpeg
  e2e-packaged.mjs              # 无 PATH 的打包版/安装版 E2E
  create-icon.ps1               # 生成 build/icon.png 与 build/icon.ico
build/
  icon.png / icon.ico           # 应用图标
resources/ffmpeg/               # 本地随包二进制，不提交 Git
test/
  phase-01-skeleton.test.tsx    # 阶段 1：骨架、安全、IPC、日志
  phase-02-media.test.tsx       # 阶段 2：解析、路径、FFmpeg、导入 UI
  phase-03-conversion.test.tsx  # 阶段 3：参数、进度、队列、真实转换、取消、UI
  phase-04-polish.test.tsx      # 阶段 4：拖拽、输出操作、关闭保护、快捷键、UI
  phase-05-delivery.test.tsx    # 阶段 5：随包布局、打包配置、环境面板移除
  phase-06-formats.test.tsx     # 阶段 6：能力矩阵、WebM/MP3 参数、真实输出、UI
  phase-07-advanced.test.tsx    # 阶段 7：高级设置、命令预览、speed/ETA、真实 480p 转换
  phase-08-history.test.tsx     # 阶段 8：历史存储/恢复、队列终态、preload、历史卡片、默认输出目录
docs/
  PROJECT_SPEC.md               # 需求规格
  DEVELOPER_GUIDE.md            # 开发者实现教程
  DELIVERY_PLAN.md              # P0/P1 交付范围、里程碑与验收标准
  TEST_PLAN.md                  # 自动化、手工验收、未覆盖项
  AI_DEVELOPMENT_LOG.md         # 真实命令、结果、决策与问题
  UI.md                         # 视觉/动效组件参考
  FFMPEG.md                     # FFmpeg 路径、随包分发与许可证
  LOGGING.md                    # 日志与测试日志约定
THIRD_PARTY_NOTICES.md          # FFmpeg/Electron/依赖许可证与源码获取方式
```

## 已实现的关键约束

1. **真实媒体链路**
   - 元数据来自 `ffprobe -show_format -show_streams -of json`。
   - 缩略图来自真实 `ffmpeg` 单帧输出。
   - 转换进度来自真实 `-progress pipe:1`。
   - 成功必须满足：退出码 0、临时文件非空、最终文件非空，且 FFprobe 确认输出编码/轨道与所选 profile 一致。
   - 无音轨 MP3 在入队阶段拒绝；仅音频输出若出现视频轨或编码不符，任务失败并清理输出。

2. **路径与边界**
   - 中文/空格路径、无音轨、损坏文件、输出名冲突、取消、FFmpeg 缺失都有测试。
   - 无音轨输入使用 `-an`，不会凭空生成音轨。
   - 输出目录与源文件相同、格式相同也不会覆盖源文件。
   - 输出目录不存在、不是目录或不可写时拒绝启动。

3. **任务体验**
   - `Ctrl+O` 打开受控文件选择器，`Ctrl+Enter` 在条件满足时开始转换。
   - 有排队/运行任务时关闭窗口会确认；确认后取消全部任务、等待真实子进程退出和临时文件清理。
   - 完成/失败任务的操作按钮只传任务 ID，由主进程从队列取出真实路径并再次校验。
   - 主界面不展示 Electron/Node/FFmpeg 版本和路径；FFmpeg 缺失时显示阻塞式错误、重新检测和日志入口。

4. **高级设置与可调试性**
   - 高级面板默认折叠，普通用户仍按“格式 + 质量预设”主流程操作。
   - 分辨率只按高度限制，`scale=-2:<height>` 保证偶数宽度且不放大源视频。
   - 命令预览使用与执行完全相同的参数构造函数；路径按 Windows 命令行展示，复制走受控剪贴板 IPC。
   - ETA 不来自定时器：`speed` 缺失时保持“估算中”，完成/取消后不显示过期剩余时间。

5. **随包 FFmpeg**
   - 解析顺序：`FRAMEFORGE_FFMPEG_DIR` → `resources/ffmpeg/<platform>-<arch>` → 旧平铺目录 → 系统 `PATH`。
   - 打包版内置 `win32-x64` 的 FFmpeg/FFprobe、DLL、LICENSE、README 和 `bundle-manifest.json`。
   - 移除系统 `PATH` 后，打包版和安装版都验证为 `source: "bundled"`。

## 安全边界

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- preload 只暴露十九个受控方法：
  - `getAppInfo()`
  - `getFfmpegStatus()`
  - `getConversionCapabilities()`
  - `selectVideos()`
  - `importVideos(paths)`
  - `getPathForFile(file)`
  - `selectOutputDirectory()`
  - `startConversions(request)`
  - `cancelConversion(jobId)`
  - `onConversionUpdate(callback)`，返回取消订阅函数
  - `openOutputFile(jobId)`
  - `showOutputInFolder(jobId)`
  - `getConversionHistory()`
  - `clearConversionHistory()`
  - `onHistoryUpdated(callback)`，返回取消订阅函数
  - `openHistoryOutput(historyId)`
  - `showHistoryOutputInFolder(historyId)`
  - `copyText(text)`
  - `openLogDirectory()`
- 不暴露 `ipcRenderer`、`fs`、`child_process`、`dialog` 或通用命令执行接口。
- renderer 不能传入自定义 FFmpeg 参数；转换参数由主进程按格式和预设构造。
- 打开文件/目录和复制文本都通过主进程受控 IPC：输出路径只接受任务 ID 或历史记录 ID，日志目录由主进程确定，复制文本限制为 20,000 字符。
- 拖拽导入只接受有限数量、绝对路径和已知视频扩展名；真正的媒体合法性仍由 FFprobe 验证。
- 主进程校验 IPC 调用方必须是当前主窗口。
- 拒绝新窗口与外部导航。
- renderer 代码不得导入 Node.js / Electron 模块，测试会扫描 `src/**` 强制检查。
- 所有外部进程都通过：

```ts
spawn(executablePath, args, { shell: false });
```

## 测试与证据

2026-10-22 已执行：

```text
npm test           8 个测试文件，141 个测试全部通过，无 skip
npm run typecheck  通过
npm run build      main / preload / renderer 构建通过
npm run dist:dir   免安装目录版构建成功
npm run e2e:packaged 目录版无 PATH 真实转换和 M4 历史持久化/恢复/清空通过
```

打包版无 PATH E2E 真实结果：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpeg: 8.0.1
输入: 阶段五 真实 视频.mp4（中文/空格路径，640×360，2000ms）
拖拽导入: 640×360，真实 JPEG 缩略图
MP4:  49,555 字节，H.264 640×360 + AAC
WebM: 73,708 字节，VP9 640×360 + Opus
MP3:  67,019 字节，仅 MP3 音频，无视频轨道
高级 MP4: 45,186 字节，H.264 854×480，无音频（480p + CRF 18 + 移除音轨）
能力探测: libx264 / aac / libvpx-vp9 / libopus / libmp3lame 全部可用
默认输出目录: 首次导入后为 ...\输入 样本
历史: 4 条完成记录写入 conversion-history.json，重启后恢复 4 条，清空后 0 条，4 个输出文件仍保留
```

截图：

- `docs/evidence/phase6-formats.png`：打包版 WebM 格式、任务队列清空/删除入口
- `docs/evidence/phase6-mp3.png`：仅音频 MP3 设置
- `docs/evidence/phase7-advanced.png`：高级设置、命令预览折叠开关与只读命令
- `docs/evidence/phase11-header-glass.png`：顶部玻璃层细节
- `docs/evidence/phase8-history.png`：重启后右侧栏恢复的转换历史
- `docs/evidence/phase5-installed.png`：安装版真实转换
- `docs/evidence/phase5-packaged.png`：目录版真实转换
- `docs/evidence/phase5-zip.png`：完整目录 zip 真实转换
- `docs/evidence/phase4-narrow.png`：窄窗口布局

详细测试矩阵、未自动化项和失败判据见 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

## FFmpeg 与许可证

当前随包：

- `ffmpeg 8.0.1-full_build-www.gyan.dev`
- Windows x64 shared build
- GPLv3 构建（包含 `--enable-gpl --enable-version3`）

随包保留 `LICENSE`、`README.txt`、`bundle-manifest.json`；源码获取方式和再分发说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [docs/FFMPEG.md](docs/FFMPEG.md)。

> 正式对外发布前仍需项目维护者确认 GPL 合规、源码提供方式和代码签名策略。

## 已知限制

- 当前单窗口、单队列、串行转换；不支持并发编码或队列暂停/重排。
- 当前格式为 MP4 / MKV / WebM / MP3；MOV、GIF、H.265、AV1 不在当前范围。
- 高级设置、只读命令预览、动态 ETA 已在 M3 完成；M4 增加历史与默认输出目录，但当前仍没有任意命令编辑、队列暂停或视频剪辑。
- 编码器能力来自启动时的 `ffmpeg -encoders`；更换 FFmpeg 构建后需要重启或重新检测。
- 输出目录、格式、质量预设和高级设置尚未持久化，关闭应用后需要重新选择；只有转换历史会持久化，最多保留最近 200 条。
- M5 视觉重做进行中；动态背景和顶部玻璃 header 已接入，其余等整体视觉参考。
- 关闭保护有单元测试和主进程接线；原生确认对话框的真实点击流程尚未自动化。
- “打开文件”和“打开日志目录”的真实系统窗口未在自动化中反复打开；输出路径存在性和 IPC 拒绝路径已测试。
- 历史记录的打开操作使用历史记录 ID，不复用重启前的队列任务 ID；历史文件损坏时会备份并回退为空列表，不会阻塞启动。
- 多文件真实拖拽未单独做 E2E；同一路径数组、数量校验和去重有单元测试。
- 当前安装包和 zip 是 M1 基线，尚未包含 M2/M3/M4 的 WebM/MP3、高级设置、ETA、历史和默认输出目录；M6 功能冻结后统一重建。
- 安装包未配置代码签名，可能出现 SmartScreen 提示。
- 独立干净 Windows VM 的安装、取消、打开输出、卸载验收尚未执行；当前是“新目录安装/zip 解压 + 移除 PATH + 静默卸载”的本机验证。
- 未保留字幕轨，未做硬件加速；这是当前 MVP 的明确范围取舍。
- macOS 只预留架构，不承诺 `.dmg`、签名或可用性。
- AOCI 完整索引已覆盖当前受管理的 85 个代码对象；新增或修改文件后需要维护索引。

## 文档

- [docs/DELIVERY_PLAN.md](docs/DELIVERY_PLAN.md)：P0/P1 范围、M0–M6 顺序和状态板
- [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md)：原始需求与验收底线
- [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)：按调用链阅读源码
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md)：测试矩阵和未覆盖项
- [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md)：目标、决策、证据和剩余工作
- [docs/FFMPEG.md](docs/FFMPEG.md)：FFmpeg 路径、打包、许可证
- [docs/AI_DEVELOPMENT_LOG.md](docs/AI_DEVELOPMENT_LOG.md)：真实决策、命令和结果
- [docs/LOGGING.md](docs/LOGGING.md)：日志约定
