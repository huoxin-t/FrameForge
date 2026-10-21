# FFmpeg / FFprobe 路径与分发方案

> 本文说明 FrameForge 当前如何找到 FFmpeg，如何执行转换，以及打包阶段准备如何随包分发。
> 记录时间：2026-10-21（阶段 3）

## 1. 当前状态

- 开发机使用系统 PATH 中的 FFmpeg：
  - `ffmpeg 8.0.1-full_build-www.gyan.dev`
  - `ffprobe 8.0.1-full_build-www.gyan.dev`
  - 实际目录：`D:\GITHUB\ffmpeg-8.0.1-full_build-shared\bin`
- 阶段 2/3 已用真实 FFmpeg/FFprobe 完成：
  - 中文/空格路径视频的元数据读取和缩略图；
  - 无音轨视频、损坏文件处理；
  - MP4/MKV 真实转换、进度解析、取消和临时文件清理。
- **截至阶段 3 尚未把 FFmpeg 二进制放进安装包。** 打包版目前会继续查找系统 PATH；随包分发在阶段 5 完成并验证。

## 2. 路径解析顺序

主进程的 `resolveFfmpegPaths()` 按以下顺序查找，要求同一目录下同时存在 `ffmpeg` 与 `ffprobe`：

1. `FRAMEFORGE_FFMPEG_DIR` 环境变量。
   - 适合开发调试、CI 或用户手工指定。
2. 随包目录：
   - 打包模式：`process.resourcesPath/ffmpeg`
   - 开发模式：`<项目根>/resources/ffmpeg`
3. 系统 PATH 中的每个目录。

找到路径后，`FfmpegService` 会真实执行：

```text
ffmpeg -version
ffprobe -version
```

只有两个命令都以 0 退出且能解析出版本号，状态才为“已就绪”。路径存在但不可执行、版本不匹配或缺少 ffprobe，都会显示可操作的错误。

## 3. 开发模式

当前开发模式不要求把二进制复制进仓库：

```text
FRAMEFORGE_FFMPEG_DIR（可选）
  > resources/ffmpeg（可选）
  > 系统 PATH
```

本项目开发机直接从系统 PATH 找到 FFmpeg。日志会记录最终来源和目录。

### 3.1 转换参数与进度

所有转换都通过：

```ts
spawn(ffmpegPath, args, { shell: false });
```

renderer 不能传自定义参数。主进程根据输出容器和预设构造参数：

```text
MP4:
  -c:v libx264 -preset medium -crf <23|20|28>
  -c:a aac -b:a 192k
  -movflags +faststart
  -stats_period 0.2 -progress pipe:1 -nostats

MKV:
  H.264/AAC 参数相同，但不传 -movflags +faststart
```

无音轨输入使用 `-an`。转换先写同目录的 `.part-<jobId>.<ext>` 临时文件；只有退出码为 0、临时文件非空、最终改名成功且最终文件非空，才标记 `completed`。

进度来自 stdout 的结构化 `key=value` 行。FFmpeg 8.0.1 的 `out_time_us` 和 `out_time_ms` 都按微秒输出，解析器同时支持 `out_time=HH:MM:SS.microseconds`；成功前进度封顶 99%，100% 由队列在文件验证后设置。

## 4. 打包模式（阶段 5 实施）

推荐方案：**随包分发 + 系统 PATH 回退**。

计划：

1. 在 `resources/ffmpeg/` 放置：
   - `ffmpeg.exe`
   - `ffprobe.exe`
   - 如果使用 shared build，还必须复制它依赖的 `avcodec-*.dll`、`avformat-*.dll` 等同目录 DLL。
2. `electron-builder` 增加：

```json
"extraResources": [
  {
    "from": "resources/ffmpeg",
    "to": "ffmpeg",
    "filter": ["**/*"]
  }
]
```

3. 打包后路径为：

```text
<安装目录>/resources/ffmpeg/ffmpeg.exe
<安装目录>/resources/ffmpeg/ffprobe.exe
```

4. 不把二进制提交进 Git：
   - `resources/ffmpeg/` 已加入 `.gitignore`；
   - 构建机通过脚本或手工准备；
   - `README` 说明来源、版本和许可证。
5. 如果随包二进制缺失或损坏，解析器回退系统 PATH，并在界面显示明确错误。

### 静态构建 vs shared 构建

- **静态构建**：`ffmpeg.exe` / `ffprobe.exe` 体积较大，但只复制两个文件，部署简单。
- **shared 构建**：exe 很小，但必须连同所有 DLL 一起复制；漏一个 DLL 就会启动失败。

当前开发机是 **shared 构建**，直接只复制 exe 不可用。阶段 5 优先准备静态构建，或把 shared 构建的完整依赖一起复制并用打包产物实测。

## 5. 许可证注意事项

当前系统构建参数包含：

```text
--enable-gpl --enable-version3
```

这意味着它是 **GPL 构建**。如果随安装包分发，必须：

- 保留 FFmpeg 的版权与许可证声明；
- 按 GPL 要求提供对应源代码或可获取方式；
- 在 README / 第三方声明中写清版本、来源和构建选项；
- 不把“npm 包能安装”等同于“再分发义务已处理”。

参考：<https://ffmpeg.org/legal.html>

在正式发布安装包前，必须由开发者确认要分发的构建来源与许可证义务。

## 6. 安全边界

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
- 不向 renderer 暴露通用命令执行接口；
- `selectVideos` 只接受系统文件选择器返回的路径；
- 每次探测/缩略图调用都有超时和错误捕获。

## 7. 已验证与未验证

已执行：

```text
npm test
```

阶段 2/3 测试使用真实 FFmpeg/FFprobe 生成、探测和转换样本，覆盖中文/空格路径、无音轨、坏文件、缩略图、路径解析优先级、FFmpeg 缺失、MP4/MKV 转换、真实进度、取消、输出冲突和临时文件清理。

尚未执行：

- 把 FFmpeg 二进制打进 `release/win-unpacked` 后，在**没有系统 FFmpeg PATH** 的机器上启动并导入视频；
- 静态构建与 shared 构建的最终选择；
- 安装包许可证文件与第三方声明的最终核对。

这些属于阶段 5 的打包验收项，不能用当前系统 PATH 的结果代替。
