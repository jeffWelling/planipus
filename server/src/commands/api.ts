import { buildApi } from "../api/app.js";
import { processAbortSignal, reportFatal } from "../process.js";
import { createRuntime, planningProviderWritesEnabled } from "../runtime.js";

async function main(): Promise<void> {
  const runtime = await createRuntime();
  const app = await buildApi({
    config: runtime.config,
    db: runtime.database.db,
    sessions: runtime.sessions,
    policies: runtime.policies,
    ...(planningProviderWritesEnabled(runtime.config) ? { planning: runtime.planning } : {}),
    ...(runtime.googleOAuth ? { googleOAuth: runtime.googleOAuth } : {})
  });
  const signal = processAbortSignal();
  signal.addEventListener("abort", () => void app.close(), { once: true });
  try {
    await app.listen({ host: runtime.config.host, port: runtime.config.port });
    if (!signal.aborted) {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    }
  } finally {
    await app.close();
    await runtime.close();
  }
}

void main().catch(reportFatal);
