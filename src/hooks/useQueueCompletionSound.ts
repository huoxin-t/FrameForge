import { useEffect, useRef } from 'react';
import completionSoundUrl from '../assets/queue-complete.mp3';

/**
 * 任务队列从“有排队/转换中任务”变为全部结束时，播放一次完成提示音。
 *
 * - 首次渲染、队列原本为空时不会触发；
 * - 手动清空已经结束的任务不会重复触发；
 * - 系统拒绝自动播放时静默跳过，不影响转换结果。
 */
export function useQueueCompletionSound(activeJobCount: number): void {
  const previousActiveJobCountRef = useRef(activeJobCount);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const previousActiveJobCount = previousActiveJobCountRef.current;
    previousActiveJobCountRef.current = activeJobCount;

    // 只有“之前还有任务在跑、现在全部结束”才算队列完毕。
    if (previousActiveJobCount === 0 || activeJobCount > 0) {
      return;
    }

    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(completionSoundUrl);
      audio.preload = 'auto';
      audioRef.current = audio;
    }

    audio.currentTime = 0;
    try {
      // 旧环境里 play() 可能返回 undefined；统一包成 Promise 再吞掉失败。
      void Promise.resolve(audio.play()).catch(() => {
        // 自动播放被浏览器或系统策略阻止时，提示音缺失不影响任务结果。
      });
    } catch {
      // 提示音失败不能影响转换流程。
    }
  }, [activeJobCount]);
}
