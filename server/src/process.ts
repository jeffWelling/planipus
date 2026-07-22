export function processAbortSignal(): AbortSignal {
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals): void => {
    controller.abort(new Error(`received ${signal}`));
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  return controller.signal;
}

export function reportFatal(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown fatal error";
  process.stderr.write(`Planipus process failed: ${message}\n`);
  process.exitCode = 1;
}
