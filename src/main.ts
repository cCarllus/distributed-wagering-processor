import { config } from "./config";
import { createApp } from "./http/api";
import { createRuntime } from "./runtime";

const runtime = await createRuntime();
const app = await createApp(runtime);
const cfg = config();
await app.listen(cfg.port, cfg.host);
if (cfg.workers) runtime.startWorkers();
runtime.telemetry.log("http_listening");
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void (async () => {
      await app.close();
      await runtime.close();
      runtime.telemetry.log("shutdown_complete");
    })().catch(() => {
      runtime.telemetry.log("shutdown_failed");
      process.exitCode = 1;
    });
  });
