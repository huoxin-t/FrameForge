# FrameForge 测试计划

> 记录时间：2026-10-22（M4 转换历史、默认输出目录和命令预览折叠完成）
>
> 原则：能自动化的必须真实执行；不能自动化的明确写“手工/未验证”，不用开发机 PATH 或 mock 结果代替干净机器验收。

## 1. 当前测试范围

| 层级 | 内容 | 状态 |
|---|---|---|
| 单元测试 | 路径校验、参数构造、进度解析、输出命名、IPC 校验、状态机 | 已覆盖 |
| 集成测试 | 真实 FFprobe/FFmpeg 生成样本、读取元数据、缩略图、MP4/MKV/WebM/MP3 转换、能力探测、取消、失败清理 | 已覆盖 |
| UI 测试 | 导入、错误态、队列、任务操作、格式能力禁用、MP3 无音轨说明、高级面板、命令预览/折叠、ETA、快捷键、窄窗口、历史卡片、默认输出目录 | 已覆盖 |
| 历史持久化 | 终态记录、去重、原子 JSON、损坏备份、最近 200 条、重启恢复、清空不删除输出 | 已覆盖 |
| 打包目录 E2E | `release/win-unpacked` 真实启动、无 PATH、内置 FFmpeg、导入、MP4/WebM/MP3、高级设置转换、输出探测、历史持久化/恢复/清空 | 已通过 |
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

当前基线（2026-10-22）：

```text
npm test          8 个测试文件，141 个测试全部通过，无 skip
npm run typecheck 通过
npm run build     main / preload / renderer 构建通过
npm run dist:dir  目录版构建成功
npm run e2e:packaged 目录版无 PATH 下 MP4/WebM/MP3 + 高级设置 + 历史持久化/恢复/清空通过
```

测试文件：

| 文件 | 覆盖 |
|---|---|
| `test/phase-01-skeleton.test.tsx` | Electron 骨架、安全边界、IPC 契约、日志、启动编排 |
| `test/phase-02-media.test.tsx` | 路径解析、FFprobe、缩略图、导入 UI、FFmpeg 状态 |
| `test/phase-03-conversion.test.tsx` | 参数、进度、串行队列、真实 MP4/MKV、取消、失败清理 |
| `test/phase-04-polish.test.tsx` | 拖拽、输出操作、关闭保护、快捷键、工作区移除、任务 UI |
| `test/phase-05-delivery.test.tsx` | 随包目录布局、打包配置、环境面板移除、FFmpeg 错误恢复 |
| `test/phase-06-formats.test.tsx` | 编码器能力矩阵、WebM/MP3 参数、输出 profile 校验、队列音频拒绝、真实输出、UI |
| `test/phase-07-advanced.test.tsx` | 分辨率/CRF/音频码率/音频模式、主进程校验、命令预览、speed/ETA、队列 telemetry、UI、真实高级转换 |
| `test/phase-08-history.test.tsx` | 历史类型/合并、主进程原子 JSON、损坏回退、队列终态去重、preload 契约、历史卡片、默认输出目录、App 并发合并 |

每个测试自动输出 START / STEP / PASS 或 FAIL，失败时带错误对象。

## 3. 真实 FFmpeg 集成

测试会用真实 FFmpeg 生成样本，不使用预置假元数据：

- 正常带音轨视频；
- 无音轨视频；
- 损坏文件；
- 中文/空格路径；
- 输出名冲突；
- 真实 MP4 / MKV 转换；
- 真实 WebM（VP9 + Opus）与 MP3 转换；
- 真实 `ffmpeg -encoders` 能力探测；
- 无音轨 MP3 入队拒绝；
- 真实 480p 缩放、CRF 18、移除音轨；
- 真实 `speed`/ETA 进度更新；
- 真实取消和临时文件清理；
- 历史 JSON 原子写入、跨实例读取、损坏备份、终态去重和 200 条上限（真实临时目录）。

真实 FFmpeg 用例依赖构建机的 FFmpeg。M1 之后，`resources/ffmpeg/<platform>-<arch>/` 存在时会优先使用随包版本。

## 4. 打包版 E2E（M1 交付链 + M2 格式 + M3 高级设置 + M4 历史）

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
7. 检查首次导入后输出目录自动变为源文件所在目录；
8. 读取 `getConversionCapabilities()`，确认五个编码器和 MP4/WebM/MP3 均可用；
9. 直接走受控 IPC 依次启动 MP4、WebM、MP3 转换，等待任务队列显示全部完成；
10. 检查三个输出文件非空，并用随包 `ffprobe` 验证视频/音频编码；
11. 用 1280×720 输入发起高级 MP4 转换（480p、CRF 18、移除音轨），验证输出为 854×480 且无音频；
12. 检查历史 API 和右侧栏出现 4 条完成记录；
13. 打开高级面板，折叠再展开 FFmpeg 命令预览并截图；
14. 检查页面不包含“运行环境 / FFmpeg 路径 / Node.js”；
15. 关闭应用，读取 `conversion-history.json` 确认 4 条记录落盘；
16. 用同一 userData 重启，确认历史卡片恢复 4 条记录并保存截图；
17. 通过界面二次确认清空历史，确认列表变空且 4 个输出文件仍存在；
18. 保存 `docs/evidence/phase6-formats.png`、`phase6-mp3.png`、`phase7-advanced.png` 和 `phase8-history.png`。

真实结果：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpegPath: ...\resources\ffmpeg\win32-x64\ffmpeg.exe
version: 8.0.1
importMode: drag-drop
输入: 阶段五 真实 视频.mp4（640×360，2000ms）
能力: libx264 / aac / libvpx-vp9 / libopus / libmp3lame 全部 true
MP4:  阶段五 真实 视频_converted.mp4，49,555 字节，H.264 640×360 + AAC
WebM: 阶段五 真实 视频_converted.webm，73,708 字节，VP9 640×360 + Opus
MP3:  阶段五 真实 视频_converted.mp3，67,019 字节，MP3 音频，无视频轨道
高级 MP4: 阶段七 高级 视频_converted.mp4，45,186 字节，H.264 854×480，无音频
默认输出目录: ...\test-results\phase5-e2e\输入 样本
历史: initial 0 → 4 条 completed → conversion-history.json 4 条 → 重启恢复 4 条 → 清空 0 条
清空后输出: 4 个输出文件全部仍存在
```

> 4.2 / 4.3 是 M1 基线历史结果。M2/M3/M4 的 E2E 脚本已扩展为能力探测、MP4/WebM/MP3、高级设置和历史持久化；当前 `release/` 里的旧安装包和 zip 仍不包含 M2/M3/M4 能力，不能直接复用新脚本。M6 重建后再执行同样验收。

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

## 5. M2 格式能力与真实输出

自动化覆盖：

```text
test/phase-06-formats.test.tsx
- OutputProfile 矩阵、扩展名、编码器需求
- 解析真实 ffmpeg -encoders 输出；缺失编码器生成原因并禁用格式
- WebM 参数：libvpx-vp9、libopus、CRF、-b:v 0、无音轨 -an
- MP3 参数：-vn、0:a:0、libmp3lame；无音轨明确拒绝
- 入队阶段真实 ffprobe 探测音轨，无音轨不启动 FFmpeg
- 真实能力服务、真实 WebM/MP3 输出、ffprobe 编码验证
- 输出 profile 校验：错误容器、错误编码、MP3 带视频轨、缺失源音轨都失败
```

真实集成结果（本机随包 FFmpeg 8.0.1）：

```text
WebM: VP9 320×240 + Opus，任务 completed，输出文件存在
MP3:  MP3 音频，无视频轨道，任务 completed
无音轨 MP4 → MP3: 入队阶段 failed，错误包含“没有音轨”，未启动 FFmpeg
```

打包版抽测见第 4.1 节，已覆盖 MP4、WebM、MP3 各一次。该抽测对象是重新构建的 `release/win-unpacked`；安装包和 zip 仍是 M1 基线，M6 重建后再执行同样抽测。

## 5.1 M3 高级设置、命令预览与动态 ETA

自动化覆盖：

```text
test/phase-07-advanced.test.tsx
- 分辨率参数：720p 生成 scale=-2:720:flags=lanczos；原始分辨率不生成 -vf；小源视频不放大
- 自定义 CRF、音频码率、移除音轨真实进入参数；MP3 不允许移除音轨
- 主进程校验分辨率、CRF 18–30、音频码率 128/192/256、音频模式；非法值拒绝
- 命令预览包含同一组参数，空格路径加引号
- speed=1.23x 解析；最近 5 个样本平滑；不足两个样本显示估算中
- 队列将 telemetry 写入任务；完成后清除 speed/ETA
- 高级面板默认折叠；修改分辨率回调完整设置；复制命令
- 运行中显示已用/剩余/速度；未知时显示估算中
- 真实 1280×720 → 480p、CRF 18、移除音轨；FFprobe 确认 854×480 且无音频
```

真实结果：

```text
高级 MP4: 45,186 字节，H.264 854×480，无音频
ETA: 真实转换中观察到 speed > 0 且 etaSeconds 非空
```

## 5.2 M4 转换历史、默认输出目录与命令预览折叠

自动化覆盖：

```text
test/phase-08-history.test.tsx
- 历史合并：按 finishedAt 倒序、按 id 去重、最多 200 条
- 主进程历史存储：只接收终态、跨实例持久化、同 job id 不重复写入
- 原子写入 JSON；损坏文件备份为 .corrupt-* 后回退为空历史
- 历史 id 只接受非空、不超过 200 字符的字符串
- 队列完成/失败/取消只触发一次 onTerminal；运行中取消不会写两次
- preload 历史读取/清空/打开/定位/事件订阅都走类型化通道并可取消订阅
- 历史卡片显示终态、筛选、缺失输出禁用、复制失败错误、二次确认清空、默认 5 条后展开全部
- 首次导入默认输出到首个有效源文件目录；手动选择后不被后续导入覆盖
- App 启动读取与主进程历史推送并发时合并，而不是互相覆盖
- 命令预览嵌套折叠/展开
```

真实结果：

```text
npm test                         8 个文件，140/140 通过，无 skip
默认输出目录                     ...\输入 样本
历史落盘                         conversion-history.json，4 条 completed
重启后恢复                       4 条，右侧栏显示 4 条已完成
清空历史                         0 条
清空后输出文件                   4/4 仍存在
```

截图：`docs/evidence/phase8-history.png`（重启后从 `userData` 恢复的历史卡片）。

## 5.3 工作区移除补丁

自动化覆盖：

```text
test/phase-04-polish.test.tsx
- 导入两项后逐项移除，计数从 2 → 1 → 空状态
- 移除只影响工作区列表，不调用文件删除 API
- 转换进行中（queued/running）禁用移除，并显示原因
```

真实结果：

```text
npx vitest run test/phase-04-polish.test.tsx   16/16 通过
npm test                                        8 个文件，140/140 通过，无 skip
```

RED/GREEN 日志：`test-results/phase9-workspace-remove-red.log`、`phase9-workspace-remove-green.log`。

## 5.4 M5 前置：全局动态点阵背景

来源：`docs/UI.md` 的 `CanvasFractalGrid` 组件。

实现要点：

```text
src/components/background/CanvasFractalGrid.tsx
- canvas 绘制点阵，鼠标附近产生波形偏移和光晕
- 渐变层通过 motion 做缓慢呼吸动画
- 深色主题下使用 screen 混合，点阵/渐变不盖住正文
- 背景容器 pointer-events-none 且位于内容层下方，不拦截点击和拖拽
- AppShell 只替换原静态径向渐变，不改动业务布局
```

真实结果：

```text
npm run typecheck                    通过
npm test                             8 个文件，140/140 通过，无 skip
npm run build                        main / preload / renderer 构建通过
打包版 E2E                           4 个真实转换、历史持久化/恢复/清空通过
CDP 手工检查                         renderer exceptions=0；高级设置正常展开
```

截图：`docs/evidence/phase6-formats.png`、`phase6-mp3.png`、`phase7-advanced.png`、`phase8-history.png`（均已更新为新背景）。

## 5.5 M5 前置：顶部玻璃 Header

来源：`docs/顶部.md` 的 `DistortedGlass`。

实现要点：

```text
src/components/HeaderGlass.tsx
- 使用 SVG feTurbulence + feDisplacementMap 生成噪声位移玻璃纹理
- 原组件的 style jsx / cn / 固定宽度改造成普通 React + 全局 CSS
- header 使用半透明深色底、backdrop-blur-xl、亮度和饱和度提升
- 玻璃层 pointer-events-none；标题和状态内容位于 z-10
```

真实结果：

```text
npm run typecheck                    通过
npm test                             8 个文件，141/141 通过，无 skip
npm run build                        main / preload / renderer 构建通过
打包版 E2E                           4 个真实转换、历史持久化/恢复/清空通过
CDP 手工检查                         header 存在纹理；renderer exceptions=0
```

截图：`docs/evidence/phase11-header-glass.png`（顶部细节）；`phase6-formats.png`、`phase6-mp3.png`、`phase7-advanced.png`、`phase8-history.png` 已更新。

## 5.6 M5 前置：任务队列终态清理

需求：已完成、失败、已取消任务会长期留在任务队列里，没有清理入口；增加终态任务单独删除和批量清空。

实现要点：

```text
src/components/JobQueue.tsx
- 有终态任务时在队列标题旁显示“清空”
- 每个终态任务卡右上角显示垃圾桶按钮
- 运行中/排队中任务不显示删除按钮，只能取消

src/App.tsx
- handleRemoveJob 只移除目标终态任务
- handleClearFinishedJobs 只保留 queued/running
- 不调用历史清空或文件删除 IPC
```

真实结果：

```text
npm run typecheck                    通过
npm test                             8 个文件，141/141 通过，无 skip
npm run build                        main / preload / renderer 构建通过
打包版 E2E                           4 个真实转换、历史持久化/恢复/清空通过
UI 截图                              phase6-formats.png 可见“清空”和终态任务垃圾桶入口
```

清空/删除只改变当前会话队列，不删除输出文件，也不清空转换历史。

## 6. 手工 / 未自动化项

| 项目 | 原因 | 当前证据 |
|---|---|---|
| 系统文件选择器点击 | 原生对话框无法用 jsdom 自动化 | 现有集成测试覆盖选择后的路径校验；真实窗口需人工点击 |
| 关闭窗口确认对话框 | 原生 `dialog.showMessageBox` 需要真实点击 | 单元测试覆盖确认/取消/等待队列逻辑 |
| 打开资源管理器/播放器 | 会打开外部系统窗口 | 主进程路径存在性、IPC 拒绝路径已测试；历史记录同样只接受历史 ID |
| 历史记录真实打开 | 会调用系统默认播放器/资源管理器 | 路径存在性、缺失输出禁用和历史 ID 校验已测试；E2E 未真实打开外部窗口 |
| 多文件真实拖拽 | 当前 E2E 使用单文件 | 单元测试覆盖多路径、数量限制和去重 |
| 独立干净 Windows VM | 当前只有本机安装目录/zip/卸载验证 | 安装包、zip、静默卸载已通过；M6 在 VM 中执行 |
| 卸载 | 只做了静默卸载和目录清理 | `install-dir-exists=False`；安装向导交互未自动化 |
| 代码签名 | 未配置证书 | 安装包可运行，但可能出现 SmartScreen 提示 |
| GPL 合规法律确认 | 需要项目维护者决定发布方式 | 已保留 LICENSE/README/source offer |

## 7. 失败判据

以下任一情况视为验收失败：

- 使用 mock 元数据、缩略图、进度或转换结果；
- 移除 PATH 后应用回退到系统 FFmpeg，或显示“未就绪”；
- 输出文件未经过退出码、临时文件、最终文件非空和 FFprobe 编码校验；
- WebM/MP3 输出编码或轨道与 profile 不符，却仍标记为完成；
- 命令预览与实际执行参数不一致；
- speed 或 ETA 未知时显示具体假倒计时；
- 高级设置越界值被接受，或分辨率对小源视频放大；
- 历史记录把 queued/running 中间态写入，或重启后丢失全部完成/失败/取消记录；
- 清空历史时删除真实输出文件；
- 用户手动选择输出目录后，后续导入又把它覆盖回源目录；
- 命令预览无法独立折叠，或折叠状态影响高级设置本身；
- 全局背景拦截点击/拖拽，或点阵/渐变导致正文不可读；
- 顶部玻璃纹理拦截点击，或玻璃层导致标题/状态文字不可读；
- 终态任务删除/清空误删输出文件或历史，或清空时移除 queued/running 任务；
- 转换进行中的媒体仍可被移出工作区，或移除时误删原文件；
- 无音轨 MP3 仍启动 FFmpeg 或显示为可用；
- 失败任务被标记为完成；
- 主界面重新出现 Electron/Node/FFmpeg 版本或路径面板；
- 安装包缺少 `resources/ffmpeg/win32-x64/`；
- 测试跳过真实 FFmpeg 用例却报告全部通过。

## 8. 后续补充

M5/M6 完成后需要追加：

- M5 视觉重做后的截图和窄/宽窗口回归；
- 格式、质量预设和高级设置持久化（当前只有历史持久化）；
- M6 干净 VM 的安装、取消、打开输出、卸载完整流程；
