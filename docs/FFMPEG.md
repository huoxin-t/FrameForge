# FFmpeg / FFprobe 路径与分发方案

> 记录时间：2026-10-21（M1 交付基线）
>
> 当前状态：FFmpeg 已随 Windows 安装包分发；在移除系统 `PATH` 和 `FRAMEFORGE_FFMPEG_DIR` 的进程中，安装目录版仍能真实导入和转换视频。

## 1. 当前随包版本

- 版本：`ffmpeg 8.0.1-full_build-www.gyan.dev`
- 构建：Windows x64 shared build
- 来源：<https://www.gyan.dev/ffmpeg/builds/>
- 随包目录：`resources/ffmpeg/win32-x64/`
- 打包后的目录：`<安装目录>/resources/ffmpeg/win32-x64/`

随包文件：

```text
ffmpeg.exe
ffprobe.exe
avcodec-62.dll
avdevice-62.dll
avfilter-11.dll
avformat-62.dll
avutil-60.dll
swresample-6.dll
swscale-9.dll
LICENSE
README.txt
bundle-manifest.json
```

shared build 的 exe 很小，但必须连同全部依赖 DLL 一起复制。漏掉任意一个 DLL，FFmpeg 会启动失败。`scripts/prepare-ffmpeg.mjs` 会复制源目录中的全部 `.dll`，不会只复制两个 exe。

`bundle-manifest.json` 记录真实的 `-version` 输出、源目录名、生成时间和每个文件的大小。

## 2. 路径解析顺序

主进程的 `resolveFfmpegPaths()` 按以下顺序查找。一个候选目录必须同时存在 `ffmpeg` 与 `ffprobe`，避免把版本不匹配的两个二进制拼在一起：

1. `FRAMEFORGE_FFMPEG_DIR` 环境变量。
   - 适合开发调试、CI 或高级用户手工指定。
2. 随包目录，按平台/架构分层：
   - 打包模式：`process.resourcesPath/ffmpeg/<platform>-<arch>/`
   - 开发模式：`<项目根>/resources/ffmpeg/<platform>-<arch>/`
3. 旧的平铺随包目录：`resources/ffmpeg/`（兼容已有开发目录和旧产物）。
4. 系统 `PATH` 中的每个目录。

找到路径后，`FfmpegService` 会真实执行：

```text
ffmpeg -version
ffprobe -version
```

只有两个命令都以 0 退出、且能从第一行解析出版本号，状态才为“已就绪”。状态中的 `source` 会是：

- `environment`：环境变量指定；
- `bundled`：随包目录；
- `system`：系统 PATH。

主界面不再展示版本和路径；这些信息写入日志，供排查使用。

## 3. 准备随包二进制

二进制不提交到 Git。`resources/ffmpeg/` 已在 `.gitignore` 中排除。

在构建机上执行：

```bash
npm run prepare:ffmpeg
```

脚本按以下顺序查找源目录：

1. `FRAMEFORGE_FFMPEG_SOURCE`；
2. `FRAMEFORGE_FFMPEG_DIR`；
3. 系统 `PATH` 中第一个同时包含 `ffmpeg` 和 `ffprobe` 的目录。

也可以显式指定：

```powershell
$env:FRAMEFORGE_FFMPEG_SOURCE = "D:\tools\ffmpeg\bin"
npm run prepare:ffmpeg
```

脚本会：

1. 清空并重建 `resources/ffmpeg/<platform>-<arch>/`；
2. 复制 `ffmpeg`、`ffprobe`、Windows 依赖 DLL；
3. 从源目录或上一级目录复制 `LICENSE`、`README.txt`；
4. 通过 `spawn(executable, ['-version'], { shell: false })` 真实执行两个二进制；
5. 写入 `bundle-manifest.json`；
6. 任一步失败就非零退出，不生成“看起来成功”的包。

当前 shared build 的总大小约 221 MB；NSIS 安装包约 167 MB，完整目录 zip 约 231 MB。

### 静态构建 vs shared 构建

- **静态构建**：只需要 `ffmpeg` / `ffprobe` 两个文件，部署简单，但单个文件更大。
- **shared 构建**：exe 小，但必须整组 DLL 一起分发；漏文件就会失败。

当前 M1 使用 shared 构建，并通过无 PATH 的安装版 E2E 验证。后续如果要减小组件数量，可以换成静态构建；`prepare-ffmpeg.mjs` 对没有 DLL 的静态目录同样适用。

## 4. 打包配置

`package.json` 中：

```json
"extraResources": [
  {
    "from": "resources/ffmpeg",
    "to": "ffmpeg",
    "filter": ["**/*"]
  }
]
```

因此：

```text
resources/ffmpeg/win32-x64/  →  <安装目录>/resources/ffmpeg/win32-x64/
```

Windows 目标：

```bash
npm run dist:win
```

产出：

- `release/FrameForge Setup 0.1.0.exe`：NSIS 安装包；
- `release/FrameForge-0.1.0-win.zip`：完整目录 zip，解压即用。

`npm run dist:dir` 生成 `release/win-unpacked/`，用于快速打包 smoke test。

## 5. 真实验证

### 5.1 自动化测试

```bash
npm test
npm run typecheck
npm run build
```

测试覆盖：

- 环境变量优先于随包目录；
- 打包模式优先解析 `resources/ffmpeg/<platform>-<arch>`；
- 开发模式支持分层目录，并保留旧平铺目录回退；
- `ffmpeg` / `ffprobe` 必须成对存在；
- 随包缺失时显示可操作错误；
- 参数始终通过 `spawn(executable, args, { shell: false })`；
- 真实 `ffmpeg -encoders` 能力探测；
- 真实 MP4/MKV/WebM/MP3 转换、进度、取消、输出冲突、输出编码校验和失败清理。

### 5.2 打包版无 PATH E2E

先构建：

```bash
npm run dist:dir
```

再执行真实 E2E：

```bash
npm run e2e:packaged
```

脚本会：

1. 启动 `release/win-unpacked/FrameForge.exe`；
2. 从子进程环境中移除 `PATH`、`FRAMEFORGE_FFMPEG_DIR` 等覆盖；
3. 确认 `getFfmpegStatus()` 返回 `source: "bundled"`；
4. 用中文/空格路径视频导入，检查 640×360 元数据和真实 JPEG 缩略图；
5. 读取真实编码器能力，确认 MP4/WebM/MP3 可用；
6. 依次启动 MP4、WebM、MP3 真实转换，等待队列完成；
7. 用随包 `ffprobe` 验证 H.264/AAC、VP9/Opus 和仅 MP3 音频输出；
8. 检查主界面没有“运行环境 / FFmpeg 路径 / Node.js”；
9. 保存 `docs/evidence/phase6-formats.png` 和 `docs/evidence/phase6-mp3.png`。

安装包验证：

```powershell
# 静默安装到临时目录，仅用于本地验收
Start-Process "release\FrameForge Setup 0.1.0.exe" `
  -ArgumentList "/S", "/D=D:\path\to\FrameForge" -Wait
```

然后：

```powershell
$env:FRAMEFORGE_E2E_EXE = "D:\path\to\FrameForge\FrameForge.exe"
$env:FRAMEFORGE_E2E_SCREENSHOT = "docs\evidence\phase5-installed.png"
npm run e2e:packaged
```

2026-10-21 M1 安装版真实结果（历史基线）：

```text
PATH: null
FRAMEFORGE_FFMPEG_DIR: null
source: bundled
ffmpegPath: <安装目录>\resources\ffmpeg\win32-x64\ffmpeg.exe
version: 8.0.1
输入: 阶段五 真实 视频.mp4（中文/空格路径，640×360，2000ms）
输出: 阶段五 真实 视频_converted.mp4，49,555 字节
输出探测: H.264 640×360
```

2026-10-22 M2 目录版真实结果（`release/win-unpacked`，安装包/zip 待 M6 重建）：

```text
source: bundled
能力: libx264 / aac / libvpx-vp9 / libopus / libmp3lame 全部可用
MP4:  49,555 字节，H.264 640×360 + AAC
WebM: 73,708 字节，VP9 640×360 + Opus
MP3:  67,019 字节，MP3 音频，无视频轨道
```

## 6. 许可证与再分发

当前构建参数包含：

```text
--enable-gpl
--enable-version3
--enable-shared
```

因此它是 **GPLv3 构建**。随安装包分发时必须保留：

- `LICENSE` 和 `README.txt`；
- 版本、来源和构建信息；
- 对应源代码的获取方式；
- `THIRD_PARTY_NOTICES.md` 中的第三方声明。

当前声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。正式对外发布前仍需开发者确认 GPL 合规和源码提供方式；本文不构成法律意见。

参考：

- <https://ffmpeg.org/legal.html>
- <https://ffmpeg.org/download.html>
- <https://www.gyan.dev/ffmpeg/builds/>

## 7. 安全边界

所有 FFmpeg/FFprobe 调用都通过：

```ts
spawn(executablePath, args, {
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

- 路径和参数只通过数组传递；
- 不拼接 shell 字符串；
- renderer 不能传原始 FFmpeg 参数；
- 不向 renderer 暴露通用命令执行接口；
- 每次探测/缩略图/转换调用都有超时、取消和错误捕获。

## 8. 仍未完成

- 代码签名证书和 Windows SmartScreen 信誉；
- 用独立 Windows 虚拟机做最终干净机器验收；
- GPL 合规的法律确认；
- 静态构建与 shared 构建的最终体积取舍；
- macOS 构建、签名和 notarization（当前只预留架构，不承诺交付）。
