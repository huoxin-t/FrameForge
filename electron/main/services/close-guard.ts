/**
 * 窗口关闭保护。
 *
 * 有排队/运行任务时，关闭窗口必须先经过用户确认；确认后取消全部任务，
 * 等待真实子进程退出和临时文件清理，再真正关闭窗口。
 */
export interface CloseEventLike {
  preventDefault: () => void;
}

export interface CloseGuardDependencies {
  hasActiveJobs: () => boolean;
  confirmExit: () => Promise<boolean>;
  cancelAll: () => void;
  waitForIdle: () => Promise<void>;
  closeWindow: () => void;
  onError?: (error: unknown) => void;
}

export function createCloseGuard(
  dependencies: CloseGuardDependencies,
): (event: CloseEventLike) => Promise<void> {
  let prompting = false;

  return async (event: CloseEventLike): Promise<void> => {
    if (!dependencies.hasActiveJobs()) {
      return;
    }

    event.preventDefault();

    if (prompting) {
      return;
    }

    prompting = true;

    try {
      const confirmed = await dependencies.confirmExit();
      if (!confirmed) {
        return;
      }

      dependencies.cancelAll();
      await dependencies.waitForIdle();
      dependencies.closeWindow();
    } catch (error) {
      dependencies.onError?.(error);
    } finally {
      prompting = false;
    }
  };
}
