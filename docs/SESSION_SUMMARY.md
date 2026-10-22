# FrameForge 会话总结（M1 交付基线 + M2 格式能力 + M3 高级设置 + M4 历史）

> 记录时间：2026-10-22
>
> 对应阶段：阶段 0–4 功能实现 + M0/M1 Windows 交付基线 + M2 格式能力层 + M3 高级设置/命令预览/动态 ETA + M4 转换历史/默认输出目录/命令预览折叠
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
- MP4/MKV/WebM/MP3 真实转换；
- 真实 `ffmpeg -encoders` 能力探测，缺失编码器时禁用格式并说明原因；
- WebM 使用 VP9 + Opus，无音轨输入使用 `-an`；
- MP3 仅音频输出；无音轨视频在入队阶段拒绝；
- 输出完成后用 FFprobe 校验容器/编码/轨道与所选 profile 一致；
- 高级设置：分辨率（原始/1080p/720p/480p，不放大、偶数宽度）、CRF 18–30、音频码率 128/192/256、保留/移除音频；
- 高级面板默认折叠；只读命令预览与实际执行共用 `buildConversionArgs()`，命令预览内部可独立展开/折叠；
- 动态 ETA：解析真实 FFmpeg `speed`，最近 5 个样本平滑；不足两个样本显示“估算中”；UI 显示已用/剩余/速度；
- 首次导入后默认使用首个有效源文件目录作为输出目录，手动选择后不被后续导入覆盖；
- 右侧栏转换历史保留完成/失败/取消终态，主进程 `userData/conversion-history.json` 原子持久化，重启恢复，最近 200 条；
- 历史支持筛选、打开文件/文件夹、复制错误、二次确认清空；清空历史不删除输出文件；
- 完成/失败/取消只记录一次终态；历史 ID 与队列任务 ID 分离，重启后不复用旧队列 ID；
- 工作区媒体卡片支持逐项移除；转换进行中的文件禁用移除，移除不会删除原文件；
- 串行任务队列、进度、取消、失败隔离；
- 输出临时文件、退出码校验、最终文件非空校验；
- `_converted` 命名和冲突避让；
- 完成任务打开文件/所在目录，失败任务复制错误/打开日志；
- 关闭窗口前的任务确认、取消和等待；
- 主界面移除开发者环境面板，保留 FFmpeg 缺失错误和恢复入口；
- FFmpeg/FFprobe、DLL、LICENSE、README 随安装包分发；
- NSIS 安装包、完整目录 zip、自定义图标；
- 无系统 PATH 的目录版和安装版真实 E2E；
- 140 个自动化测试全部通过，无 skip；
- README、开发者教程、测试计划、FFmpeg 分发说明、第三方声明、开发日志。

### 未完成

- M4：已完成转换历史、默认输出目录、命令预览折叠；完成提示音和设置持久化仍属于可选 P1，未开始；
- M5：整体视觉重做；等开发者给出设计参考和组件策略后调整；
- M6：最终安装包、独立干净 VM 的安装/取消/打开输出/卸载、`SESSION_SUMMARY.md` 最终版、GitHub Release；
- 代码签名；
- GPL 合规的最终法律确认；
- macOS `.dmg`、签名和 notarization（只预留架构，不承诺交付）。

## 3. 关键决策

| 决策 | 原因 |
|---|---|
| Electron 45 + electron-vite + React 19 | 需要原生文件选择器、本地绝对路径和子进程；Vite 构建链简单 |
| 主进程负责所有文件/进程 | renderer 不接触 Node，安全边界清晰 |
| preload 只暴露 19 个 typed 方法 | 避免把 `ipcRenderer`、`fs`、`child_process` 暴露给页面 |
| `spawn(executable, args, { shell: false })` | 参数数组避免 shell 注入和中文/空格路径转义问题 |
| 临时文件 + 退出码 + 非空 + FFprobe 编码校验 | 防止半成品、错误编码或错误轨道被标记完成 |
| 串行队列 | MVP 范围可控，失败隔离和取消逻辑可验证 |
| 进度只来自 `-progress pipe:1` | 不用定时器伪造进度 |
| `OutputProfile` 作为唯一格式来源 | 扩展名、编码器、参数和 UI 不再靠 if/else 堆叠 |
| `shared/conversion-args.ts` 同时服务执行与预览 | 避免“预览一套、实际执行另一套”的漂移 |
| ETA 只用真实 `speed`，不足样本显示估算中 | 不伪造倒计时；取消/完成后清除过期值 |
| 历史只由主进程写 `userData` JSON | renderer 不接触文件系统；原子临时文件 + rename，损坏备份后回退 |
| 历史动作使用历史 ID | 队列任务 ID 重启后失效，不能用旧任务 ID 打开新会话输出 |
| 首次导入自动填源目录，手动选择后锁定 | 减少普通用户操作，同时不覆盖明确意图 |
| 能力探测先于 UI 可用性 | 不把当前 FFmpeg 构建不支持的格式显示为可用 |
| FFmpeg 按 `<platform>-<arch>` 分层 | 为 Windows/Mac 和不同架构预留，避免硬编码 |
| 当前使用 shared build | 本机已有可用构建；通过整目录 DLL 复制和无 PATH E2E 验证 |
| NSIS + 完整目录 zip | 安装包适合普通用户，zip 适合快速试用和排查 |
| 环境面板移除 | 普通用户不需要 Electron/Node/FFmpeg 版本；错误时再给操作入口 |
| 视觉延后 | 先保证功能、格式和交付链，避免视觉返工 |

## 4. 真实证据

### 4.1 自动化测试

```text
npm test           8 个测试文件，140 个测试全部通过，无 skip
npm run typecheck  通过
npm run build      main / preload / renderer 构建通过
```

测试文件：

- `phase-01-skeleton.test.tsx`：骨架、安全、IPC、日志、启动编排；
- `phase-02-media.test.tsx`：路径解析、FFprobe、缩略图、导入 UI；
- `phase-03-conversion.test.tsx`：参数、进度、队列、真实转换、取消；
- `phase-04-polish.test.tsx`：拖拽、输出操作、关闭保护、快捷键、工作区移除；
- `phase-05-delivery.test.tsx`：随包布局、打包配置、环境面板移除；
- `phase-06-formats.test.tsx`：能力矩阵、WebM/MP3 参数、输出校验、真实格式转换、UI；
- `phase-07-advanced.test.tsx`：高级设置参数、主进程校验、命令预览、速度平滑、队列 telemetry、UI、真实 480p/移除音轨转换；
- `phase-08-history.test.tsx`：历史类型/合并、原子 JSON、损坏回退、队列终态去重、preload 契约、历史卡片筛选/展开、默认输出目录、并发合并。

### 4.2 打包版无 PATH E2E

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpeg: 8.0.1
ffmpegPath: <打包目录>/resources/ffmpeg/win32-x64/ffmpeg.exe
importMode: drag-drop
输入: 阶段五 真实 视频.mp4（中文/空格路径，640×360，2000ms）
能力: libx264 / aac / libvpx-vp9 / libopus / libmp3lame 全部可用
MP4:  49,555 字节，H.264 640×360 + AAC
WebM: 73,708 字节，VP9 640×360 + Opus
MP3:  67,019 字节，MP3 音频，无视频轨道
高级 MP4: 45,186 字节，H.264 854×480，无音频（CRF 18 + 480p + 移除音轨）
默认输出目录: ...\输入 样本
历史: 0 → 4 条 completed → JSON 落盘 4 条 → 重启恢复 4 条 → 清空 0 条
清空后输出: 4 个文件全部仍存在
```

截图：

- `docs/evidence/phase6-formats.png`：WebM 格式与能力说明；
- `docs/evidence/phase6-mp3.png`：仅音频 MP3 设置；
- `docs/evidence/phase7-advanced.png`：高级设置、命令预览折叠开关与只读命令；
- `docs/evidence/phase8-history.png`：重启后右侧栏恢复的转换历史；
- `docs/evidence/phase5-installed.png`：M1 安装版；
- `docs/evidence/phase5-packaged.png`：M1 目录版；
- `docs/evidence/phase5-zip.png`：M1 完整目录 zip。

### 4.3 安装包 / zip / 卸载

```text
release/FrameForge Setup 0.1.0.exe   167 MB（M1 基线）
release/FrameForge-0.1.0-win.zip     230.6 MB（M1 基线）
```

- NSIS 静默安装到新目录，安装器退出码 0；安装目录包含完整 FFmpeg 资源、许可证和 `THIRD_PARTY_NOTICES.md`；
- 完整目录 zip 解压后同样通过无 PATH E2E，`source: "bundled"`；
- `Uninstall FrameForge.exe /S` 退出码 0，安装目录被清理；
- M2/M3/M4 的打包版验证使用重新构建的 `release/win-unpacked`；安装包和 zip 仍是 M1 基线，在 M6 功能冻结后统一重建。

## 5. 用户反馈如何落实

| 反馈 | 落实 |
|---|---|
| 不要展示运行环境和 FFmpeg 版本/路径 | 删除 `EnvironmentPanel`，只在 FFmpeg 缺失时显示阻塞式错误 |
| 必须真正随包 FFmpeg | 新增准备脚本、分层布局、extraResources、无 PATH E2E |
| 尽量保证主函数只调用 | `main()` 只装配依赖并调用 `runMain()`；`runMain()` 只按顺序调用阶段函数；FFmpeg 准备脚本和 E2E 也拆成小函数 |
| 先做可交付 Windows 客户端 | M1 优先完成安装包、图标、随包和安装版验证 |
| 不伪造进度/结果 | 进度来自 `-progress pipe:1`，成功必须通过退出码、文件非空和 FFprobe 编码校验 |
| 中文/空格路径、无音轨、坏文件 | 单元/集成测试和真实 E2E 覆盖 |
| 格式扩展不要假支持 | 先真实探测编码器，再让 UI 显示可用格式 |
| 高级设置里的命令预览也要能折叠 | 增加嵌套的展开/折叠按钮，默认展开，不影响高级面板本身 |
| 转换历史放右侧栏并保留在重启后 | 主进程 JSON 原子持久化，右侧栏卡片加载并订阅终态事件 |
| 清空历史不能删文件 | 清空只写历史文件；E2E 在清空后逐个确认 4 个输出仍存在 |
| 输出目录默认源文件目录但可手选 | 首次有效导入自动填充；手动选择后不再被后续导入覆盖 |
| 视觉方向待定 | 没有擅自大改视觉；保留现有深色工作台 |

## 6. 面试可讲的工程点

1. **进程边界**：renderer 只调用 preload 方法，主进程持有文件系统和子进程能力。
2. **真实媒体链路**：FFprobe JSON → 媒体卡片 → `OutputProfile` → FFmpeg 参数 → 进度 → FFprobe 输出校验。
3. **能力探测**：真实执行 `ffmpeg -encoders`，缺失编码器时禁用格式，避免“UI 支持但转换失败”。
4. **交付链**：shared FFmpeg 的 DLL 依赖、平台/架构资源布局、extraResources、无 PATH E2E。
5. **失败设计**：坏文件、无音轨、缩略图失败、取消、关闭窗口、FFmpeg 缺失、输出编码不符。
6. **测试先行**：每个阶段有真实 RED、实现、GREEN 和证据日志。
7. **持久化与竞态**：历史只在终态写入，JSON 原子替换、损坏回退、200 条上限；启动读取与事件推送按 ID 合并，避免后到的旧快照覆盖新记录。
8. **边界诚实**：安装包未签名、独立干净 VM 未验收、GPL 未法律确认，都明确写出。

## 7. 风险与边界

- FFmpeg 是 GPLv3 shared build，正式发布前需要维护者确认再分发和源码提供方式；
- 安装包未签名，可能出现 SmartScreen 提示；
- 独立干净 Windows VM 尚未执行完整安装/卸载验收；
- 当前只在新目录安装、zip 解压和静默卸载的本机环境验证；
- M2/M3/M4 的安装包/zip 尚未重建；当前证据使用 `release/win-unpacked`；
- 输出目录、格式、质量预设和高级设置尚未持久化；只有转换历史持久化；
- 视觉方向待开发者给出参考后再调整 M5；
- Mac 只预留架构，不承诺可用。

## 8. 下一步

1. M2/M3/M4 已本地提交；网络恢复后推送到 `origin/main`；
2. 等开发者验收 M4 的真实行为、UI 和证据；
3. M5 根据开发者参考调整视觉方向；
4. M6 重建最终安装包/zip、独立干净 VM、`SESSION_SUMMARY.md` 最终版、GitHub Release。

详细计划见 [DELIVERY_PLAN.md](DELIVERY_PLAN.md)。
