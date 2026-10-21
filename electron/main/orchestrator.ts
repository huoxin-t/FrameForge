export interface MainDependencies {
  initLogger: () => Promise<void> | void;
  registerIpcHandlers: () => void;
  createMainWindow: () => Promise<void> | void;
  registerAppLifecycle: () => void;
}

export async function runMain(dependencies: MainDependencies): Promise<void> {
  await dependencies.initLogger();
  dependencies.registerIpcHandlers();
  await dependencies.createMainWindow();
  dependencies.registerAppLifecycle();
}
