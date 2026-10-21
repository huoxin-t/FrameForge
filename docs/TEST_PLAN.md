# FrameForge 测试计划

> 记录时间：2026-10-21（M1 交付基线）
>
> 原则：能自动化的必须真实执行；不能自动化的明确写“手工/未验证”，不用开发机 PATH 或 mock 结果代替干净机器验收。

## 1. 当前测试范围

| 层级 | 内容 | 状态 |
|---|---|---|
| 单元测试 | 路径校验、参数构造、进度解析、输出命名、IPC 校验、状态机 | 已覆盖 |
| 集成测试 | 真实 FFprobe/FFmpeg 生成样本、读取元数据、缩略图、MP4/MKV 转换、取消、失败清理 | 已覆盖 |
| UI 测试 | 导入、错误态、队列、任务操作、快捷键、窄窗口 | 已覆盖 |
| 打包目录 E2E | `release/win-unpacked` 真实启动、无 PATH、内置 FFmpeg、导入、转换、输出探测 | 已通过 |
| 安装包 smoke test | NSIS 静默安装到新目录、启动、无 PATH 转换 | 已通过 |
| 便携 zip E2E | 解压完整目录 zip、启动、无 PATH 转换 | 已通过 |
| 卸载 smoke test | NSIS 静默卸载、安装目录清理 | 已通过 |
| 独立干净 Windows VM | 无 Node、无开发工具、无 FFmpeg 的全新系统安装/卸载 | 未执行 |
| 原生系统对话框 | 文件选择器、关闭确认、打开资源管理器 | 未自动化 |
| macOS | 构建、签名、notarization | 未执行，仅预留架构 |

## 2. 自动化命令

```bash
npm test
npm run typecheck
npm run build
npm run dist:dir
npm run e2e:packaged
npm run dist:win
```

当前基线（2026-10-21）：

```text
npm test          5 个测试文件，93 个测试全部通过，无 skip
npm run typecheck 通过
npm run build     main / preload / renderer 构建通过
npm run dist:dir  目录版构建成功
npm run dist:win  NSIS 安装包 + 完整目录 zip 构建成功
```

测试文件：

| 文件 | 覆盖 |
|---|---|
| `test/phase-01-skeleton.test.tsx` | Electron 骨架、安全边界、IPC 契约、日志、启动编排 |
| `test/phase-02-media.test.tsx` | 路径解析、FFprobe、缩略图、导入 UI、FFmpeg 状态 |
| `test/phase-03-conversion.test.tsx` | 参数、进度、串行队列、真实 MP4/MKV、取消、失败清理 |
| `test/phase-04-polish.test.tsx` | 拖拽、输出操作、关闭保护、快捷键、任务 UI |
| `test/phase-05-delivery.test.tsx` | 随包目录布局、打包配置、环境面板移除、FFmpeg 错误恢复 |

每个测试自动输出 START / STEP / PASS 或 FAIL，失败时带错误对象。

## 3. 真实 FFmpeg 集成

测试会用真实 FFmpeg 生成样本，不使用预置假元数据：

- 正常带音轨视频；
- 无音轨视频；
- 损坏文件；
- 中文/空格路径；
- 输出名冲突；
- 真实 MP4 / MKV 转换；
- 真实取消和临时文件清理。

真实 FFmpeg 用例依赖构建机的 FFmpeg。M1 之后，`resources/ffmpeg/<platform>-<arch>/` 存在时会优先使用随包版本。

## 4. M1 打包版 E2E

### 4.1 目录版

执行：

```bash
npm run dist:dir
npm run e2e:packaged
```

脚本 `scripts/e2e-packaged.mjs` 会：

1. 启动 `release/win-unpacked/FrameForge.exe`；
2. 从子进程环境移除 `PATH`、`FRAMEFORGE_FFMPEG_DIR`、`FRAMEFORGE_FFMPEG_SOURCE`；
3. 通过 CDP 连接真实 renderer；
4. 确认 `getFfmpegStatus()` 的 `source` 为 `bundled`；
5. 通过 CDP 拖拽中文/空格路径视频到工作区；
6. 检查 640×360 元数据和真实 JPEG 缩略图；
7. 启动真实 MP4 转换，等待队列显示“已完成”；
8. 检查输出文件非空；
9. 用随包 `ffprobe` 验证输出为 H.264 640×360；
10. 检查页面不包含“运行环境 / FFmpeg 路径 / Node.js”；
11. 保存 `docs/evidence/phase5-packaged.png`。

真实结果：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpegPath: ...\resources\ffmpeg\win32-x64\ffmpeg.exe
version: 8.0.1
importMode: drag-drop
输入: 阶段五 真实 视频.mp4（640×360，2000ms）
输出: 阶段五 真实 视频_converted.mp4，49,555 字节
输出探测: H.264 640×360
```

### 4.2 安装包

执行：

```powershell
Start-Process "release\FrameForge Setup 0.1.0.exe" `
  -ArgumentList "/S", "/D=D:\path\to\FrameForge" -Wait
```

然后：

```powershell
$env:FRAMEFORGE_E2E_EXE = "D:\path\to\FrameForge\FrameForge.exe"
$env:FRAMEFORGE_E2E_SCREENSHOT = "docs\evidence\phase5-installed.png"
npm run e2e:packaged
```

真实结果：

```text
installer-exit=0
安装目录包含 resources/ffmpeg/win32-x64/ffmpeg.exe、ffprobe.exe 和全部 DLL
resources/THIRD_PARTY_NOTICES.md 存在
source: bundled
输入/输出/探测结果与目录版一致
```

截图：`docs/evidence/phase5-installed.png`。

### 4.3 完整目录 zip

执行：

```powershell
Expand-Archive -LiteralPath "release\FrameForge-0.1.0-win.zip" `
  -DestinationPath "D:\path\to\FrameForge-zip" -Force
$env:FRAMEFORGE_E2E_EXE = "D:\path\to\FrameForge-zip\FrameForge.exe"
$env:FRAMEFORGE_E2E_SCREENSHOT = "docs\evidence\phase5-zip.png"
npm run e2e:packaged
```

真实结果：

```text
source: bundled
ffmpegPath: ...\FrameForge-zip\resources\ffmpeg\win32-x64\ffmpeg.exe
输入/输出/探测结果与安装版一致
resources/THIRD_PARTY_NOTICES.md 存在
```

截图：`docs/evidence/phase5-zip.png`。

### 4.4 静默卸载

执行：

```powershell
Start-Process "D:\path\to\FrameForge\Uninstall FrameForge.exe" `
  -ArgumentList "/S" -Wait
```

真实结果：

```text
uninstaller-exit=0
install-dir-exists=False
```

> 说明：这是“新目录安装 + 移除 PATH + 静默卸载”的本机验证，不是独立 Windows VM。M6 仍需在干净 VM 中完成安装、取消、打开输出和卸载验收。

## 5. 手工 / 未自动化项

| 项目 | 原因 | 当前证据 |
|---|---|---|
| 系统文件选择器点击 | 原生对话框无法用 jsdom 自动化 | 现有集成测试覆盖选择后的路径校验；真实窗口需人工点击 |
| 关闭窗口确认对话框 | 原生 `dialog.showMessageBox` 需要真实点击 | 单元测试覆盖确认/取消/等待队列逻辑 |
| 打开资源管理器/播放器 | 会打开外部系统窗口 | 主进程路径存在性、IPC 拒绝路径已测试 |
| 多文件真实拖拽 | 当前 E2E 使用单文件 | 单元测试覆盖多路径、数量限制和去重 |
| 独立干净 Windows VM | 当前只有本机安装目录/zip/卸载验证 | 安装包、zip、静默卸载已通过；M6 在 VM 中执行 |
| 卸载 | 只做了静默卸载和目录清理 | `install-dir-exists=False`；安装向导交互未自动化 |
| 代码签名 | 未配置证书 | 安装包可运行，但可能出现 SmartScreen 提示 |
| GPL 合规法律确认 | 需要项目维护者决定发布方式 | 已保留 LICENSE/README/source offer |

## 6. 失败判据

以下任一情况视为验收失败：

- 使用 mock 元数据、缩略图、进度或转换结果；
- 移除 PATH 后应用回退到系统 FFmpeg，或显示“未就绪”；
- 输出文件未经过退出码、临时文件、最终文件三重验证；
- 失败任务被标记为完成；
- 主界面重新出现 Electron/Node/FFmpeg 版本或路径面板；
- 安装包缺少 `resources/ffmpeg/win32-x64/`；
- 测试跳过真实 FFmpeg 用例却报告全部通过。

## 7. 后续补充

M2/M3 完成后需要追加：

- WebM（VP9 + Opus）真实输出与 `ffprobe` 验证；
- MP3 音频提取、无音轨拒绝；
- 编码器能力探测缺失路径；
- 高级设置、命令预览与实际参数一致性；
- 动态 ETA 真实 `speed` 采样；
- 打包版 WebM/MP3 抽测；
- M6 干净 VM 的安装、取消、打开输出、卸载完整流程。
