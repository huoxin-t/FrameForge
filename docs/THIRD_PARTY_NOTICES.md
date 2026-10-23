# Third-Party Notices

FrameForge 0.1.0（2026-10-21）

本文件记录随 Windows 安装包分发的第三方组件、版本、许可证和源码获取方式。它不是法律意见；正式发布前仍需项目维护者确认合规性。

## 1. FFmpeg / FFprobe

- 组件：FFmpeg、FFprobe
- 版本：`8.0.1-full_build-www.gyan.dev`
- 构建来源：<https://www.gyan.dev/ffmpeg/builds/>
- 随包位置：`resources/ffmpeg/win32-x64/`
- 构建类型：Windows x64 shared build
- 许可证：**GNU General Public License v3（GPLv3）**
- 构建参数包含：`--enable-gpl`、`--enable-version3`、`--enable-shared`、`--enable-libx264`、`--enable-libx265`、`--enable-libvpx`、`--enable-libopus`、`--enable-libmp3lame`

随包目录中包含：

- `LICENSE`：GPLv3 许可证全文；
- `README.txt`：构建来源和组件说明；
- `bundle-manifest.json`：真实版本、生成时间和文件大小。

对应源码：

- FFmpeg 8.0.1 源码：<https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz>
- FFmpeg 源码仓库：<https://git.ffmpeg.org/ffmpeg.git>
- gyan.dev 构建信息：<https://www.gyan.dev/ffmpeg/builds/>

FrameForge 分发的是未修改的 FFmpeg 二进制。若你需要对应源代码副本，请在收到本分发版本后三年内通过项目 issue 联系维护者：

- <https://github.com/huoxin-t/FrameForge/issues>

我们会在合理时间内提供对应源码，或给出可公开访问的源码下载地址。

FFmpeg 及其包含的第三方库按各自许可证提供，**不提供任何担保**。完整许可证和组件说明以随包的 `LICENSE`、`README.txt` 为准。

## 2. Electron / Chromium / Node.js

- Electron 45：MIT License
- Chromium：BSD-style 许可证及其他开源许可证
- Node.js：MIT License

安装包内包含 Electron 自带的：

- `LICENSE.electron.txt`
- `LICENSES.chromium.html`

这些文件位于应用安装目录根部，随 Electron 运行时一起分发。

## 3. 运行时 npm 依赖

| 组件 | 版本范围 | 许可证 |
|---|---|---|
| React | 19.x | MIT |
| React DOM | 19.x | MIT |
| lucide-react | 1.x | ISC |
| electron-log | 5.x | MIT |

完整依赖树和版本锁定见 `package-lock.json`。

## 4. 构建与测试依赖

| 组件 | 许可证 |
|---|---|
| TypeScript | Apache-2.0 |
| Vite | MIT |
| electron-vite | MIT |
| Tailwind CSS | MIT |
| Vitest | MIT |
| Testing Library | MIT |
| electron-builder | MIT |

构建工具不会作为应用运行时依赖打包进最终安装包。

## 5. 图标与截图

FrameForge 应用图标由项目内的 `scripts/create-icon.ps1` 使用 PowerShell + System.Drawing 生成，不包含第三方图标素材。

`docs/evidence/` 中的截图来自本项目真实运行的打包版，不包含第三方版权素材。
