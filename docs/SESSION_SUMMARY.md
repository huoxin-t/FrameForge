# FrameForge 会话总结（M1 交付基线）

> 记录时间：2026-10-21
>
> 对应阶段：阶段 0–4 功能实现 + M0/M1 Windows 交付基线
>
> 本文是给开发者、面试官和后续接手者看的会话总结；真实命令、RED/GREEN 和问题细节在 [AI_DEVELOPMENT_LOG.md](AI_DEVELOPMENT_LOG.md)。

## 1. 目标

把 FrameForge 做成一个真正可安装、可运行的 Windows 本地视频转换客户端，而不是只会在开发机启动的 Electron Demo。

核心要求：

- 用真实 `ffmpeg` / `ffprobe` 读取元数据、生成缩略图、转换视频；
- 不使用假元数据、假缩略图、假进度或假成功；
- renderer 不能直接访问 Node/Electron，只暴露最小 typed preload API；
- 所有外部进程都用 `spawn(executable, args, { shell: false })`；
- 处理中文/空格路径、无音轨、损坏文件、输出冲突、取消、FFmpeg 缺失；
- 最终交付 Windows 安装包，并尽量在干净环境验证；
- 代码组织保持“主函数只调用”，把业务细节拆到可测试的小函数。

## 2. 当前完成度

### 已完成

- Electron + React + TypeScript 桌面骨架；
- 系统文件选择器和受控拖拽导入；
- 真实 FFprobe 元数据；
- 真实 FFmpeg 缩略图，失败时降级；
- MP4/MKV 真实转换；
- 串行任务队列、进度、取消、失败隔离；
- 输出临时文件、退出码校验、输出文件非空校验；
- `_converted` 命名和冲突避让；
- 完成任务打开文件/所在目录，失败任务复制错误/打开日志；
- 关闭窗口前的任务确认、取消和等待；
- 主界面移除开发者环境面板，保留 FFmpeg 缺失错误和恢复入口；
- FFmpeg/FFprobe、DLL、LICENSE、README 随安装包分发；
- NSIS 安装包、完整目录 zip、自定义图标；
- 无系统 PATH 的目录版和安装版真实 E2E；
- 93 个自动化测试全部通过，无 skip；
- README、开发者教程、测试计划、FFmpeg 分发说明、第三方声明、开发日志。

### 未完成

- M2：格式能力层、WebM（VP9 + Opus）、仅音频 MP3；
- M3：高级设置、只读命令预览、动态 ETA；
- M4：完成提示音、输出设置持久化（可选）；
- M5：整体视觉重做；
- M6：最终安装包、独立干净 VM 的安装/取消/打开输出/卸载、`SESSION_SUMMARY.md` 最终版、GitHub Release；
- 代码签名；
- GPL 合规的最终法律确认；
- macOS `.dmg`、签名和 notarization（只预留架构，不承诺交付）。

## 3. 关键决策

| 决策 | 原因 |
|---|---|
| Electron 45 + electron-vite + React 19 | 需要原生文件选择器、本地绝对路径和子进程；Vite 构建链简单 |
| 主进程负责所有文件/进程 | renderer 不接触 Node，安全边界清晰 |
| preload 只暴露 13 个 typed 方法 | 避免把 `ipcRenderer`、`fs`、`child_process` 暴露给页面 |
| `spawn(executable, args, { shell: false })` | 参数数组避免 shell 注入和中文/空格路径转义问题 |
| 临时文件 + 退出码 + 非空校验 | 防止半成品被标记完成 |
| 串行队列 | MVP 范围可控，失败隔离和取消逻辑可验证 |
| 进度只来自 `-progress pipe:1` | 不用定时器伪造进度 |
| FFmpeg 按 `<platform>-<arch>` 分层 | 为 Windows/Mac 和不同架构预留，避免硬编码 |
| 当前使用 shared build | 本机已有可用构建；通过整目录 DLL 复制和无 PATH E2E 验证 |
| NSIS + 完整目录 zip | 安装包适合普通用户，zip 适合快速试用和排查 |
| 环境面板移除 | 普通用户不需要 Electron/Node/FFmpeg 版本；错误时再给操作入口 |
| 视觉延后 | 先保证功能、格式和交付链，避免视觉返工 |

## 4. 真实证据

### 4.1 自动化测试

```text
npm test           5 个测试文件，93 个测试全部通过，无 skip
npm run typecheck  通过
npm run build      main / preload / renderer 构建通过
```

测试文件：

- `phase-01-skeleton.test.tsx`：骨架、安全、IPC、日志、启动编排；
- `phase-02-media.test.tsx`：路径解析、FFprobe、缩略图、导入 UI；
- `phase-03-conversion.test.tsx`：参数、进度、队列、真实转换、取消；
- `phase-04-polish.test.tsx`：拖拽、输出操作、关闭保护、快捷键；
- `phase-05-delivery.test.tsx`：随包布局、打包配置、环境面板移除。

### 4.2 打包版无 PATH E2E

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpeg: 8.0.1
ffmpegPath: <安装目录>/resources/ffmpeg/win32-x64/ffmpeg.exe
importMode: drag-drop
输入: 阶段五 真实 视频.mp4（中文/空格路径，640×360，2000ms）
输出: 阶段五 真实 视频_converted.mp4，49,555 字节
输出探测: H.264 640×360
```

截图：

- `docs/evidence/phase5-installed.png`
- `docs/evidence/phase5-packaged.png`
- `docs/evidence/phase5-zip.png`

### 4.3 安装包 / zip / 卸载

```text
release/FrameForge Setup 0.1.0.exe   167 MB
release/FrameForge-0.1.0-win.zip     230.6 MB
```

- NSIS 静默安装到新目录，安装器退出码 0；安装目录包含完整 FFmpeg 资源、许可证和 `THIRD_PARTY_NOTICES.md`；
- 完整目录 zip 解压后同样通过无 PATH E2E，`source: "bundled"`；
- `Uninstall FrameForge.exe /S` 退出码 0，安装目录被清理。

## 5. 用户反馈如何落实

| 反馈 | 落实 |
|---|---|
| 不要展示运行环境和 FFmpeg 版本/路径 | 删除 `EnvironmentPanel`，只在 FFmpeg 缺失时显示阻塞式错误 |
| 必须真正随包 FFmpeg | 新增准备脚本、分层布局、extraResources、无 PATH E2E |
| 尽量保证主函数只调用 | `main()` 只装配依赖并调用 `runMain()`；`runMain()` 只按顺序调用阶段函数；FFmpeg 准备脚本和 E2E 也拆成小函数 |
| 先做可交付 Windows 客户端 | M1 优先完成安装包、图标、随包和安装版验证 |
| 不伪造进度/结果 | 进度来自 `-progress pipe:1`，成功必须通过退出码和文件校验 |
| 中文/空格路径、无音轨、坏文件 | 单元/集成测试和真实 E2E 覆盖 |
| 视觉方向待定 | 没有擅自大改视觉；保留现有深色工作台 |

## 6. 面试可讲的工程点

1. **进程边界**：renderer 只调用 preload 方法，主进程持有文件系统和子进程能力。
2. **真实媒体链路**：FFprobe JSON → 媒体卡片 → FFmpeg 参数 → 进度 → 输出验证。
3. **交付链**：shared FFmpeg 的 DLL 依赖、平台/架构资源布局、extraResources、无 PATH E2E。
4. **失败设计**：坏文件、无音轨、缩略图失败、取消、关闭窗口、FFmpeg 缺失。
5. **测试先行**：每个阶段有真实 RED、实现、GREEN 和证据日志。
6. **边界诚实**：安装包未签名、独立干净 VM 未验收、GPL 未法律确认，都明确写出。

## 7. 风险与边界

- FFmpeg 是 GPLv3 shared build，正式发布前需要维护者确认再分发和源码提供方式；
- 安装包未签名，可能出现 SmartScreen 提示；
- 独立干净 Windows VM 尚未执行完整安装/卸载验收；
- 当前只在新目录安装、zip 解压和静默卸载的本机环境验证；
- 当前只支持 MP4/MKV；WebM/MP3 待 M2；
- 高级设置、命令预览、动态 ETA 待 M3；
- 视觉方向待开发者确认；
- Mac 只预留架构，不承诺可用。

## 8. 下一步

1. 提交 M1 变更；
2. 进入 M2：`OutputProfile`、`ffmpeg -encoders` 能力探测、WebM、MP3；
3. 进入 M3：高级设置、命令预览、动态 ETA；
4. M4 可选 polish；
5. M5 视觉；
6. M6 最终安装包、独立干净 VM、`SESSION_SUMMARY.md` 最终版、GitHub Release。

详细计划见 [DELIVERY_PLAN.md](DELIVERY_PLAN.md)。
