import type { ProcessWager } from "../application/process-wager";
import type { Telemetry } from "../infrastructure/observability/telemetry";
export class ReferenceWorker {
  constructor(
    private readonly processor: ProcessWager,
    private readonly telemetry: Telemetry,
  ) {}
  async tick(): Promise<number> {
    let done = 0;
    while (done < 25 && (await this.processor.retryReference())) {
      this.telemetry.retries.inc({ component: "reference" });
      done++;
    }
    return done;
  }
}
