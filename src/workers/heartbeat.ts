/** At most one extension is in flight. stop() drains it before ACK/backoff/release. */
export class Heartbeat {
  private stopped = false;
  private running?: Promise<void>;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(intervalMs: number, work: () => Promise<unknown>, onError: () => void) {
    this.timer = setInterval(() => {
      if (this.stopped || this.running) return;
      this.running = Promise.resolve()
        .then(work)
        .then(() => {}, onError)
        .finally(() => {
          this.running = undefined;
        });
    }, intervalMs);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
}
