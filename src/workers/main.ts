import { createRuntime } from "../runtime";

const runtime = await createRuntime();
runtime.startWorkers();
runtime.telemetry.log("workers_started");
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void runtime
      .close()
      .then(() => runtime.telemetry.log("shutdown_complete"))
      .catch(() => {
        process.exitCode = 1;
      });
  });
