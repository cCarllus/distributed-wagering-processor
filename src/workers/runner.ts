import type { Telemetry } from "../infrastructure/observability/telemetry";
export class WorkerRunner {
  private stopping = false;
  private tasks: Promise<void>[] = [];
  constructor(private readonly telemetry: Telemetry) {}
  start(workers: { name: string; tick: () => Promise<unknown> }[]): void {
    this.tasks = workers.map(async (worker) => {
      while (!this.stopping) {
        try {
          await worker.tick();
        } catch {
          this.telemetry.log("worker_unavailable", {
            code: `${worker.name.toUpperCase()}_UNAVAILABLE`,
          });
        }
        if (!this.stopping) await Bun.sleep(100);
      }
    });
  }
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.tasks);
  }
}
