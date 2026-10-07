import { StopError } from "./journal";

// An operation may ignore cancellation (notably the signer SDK). A late result
// must never let the caller start a new operation after the request cutoff.
export class PaymentBudget {
  constructor(readonly deadlineMs?: number) {}
  remaining(): number {
    const ms = this.deadlineMs === undefined ? Infinity : Math.floor(this.deadlineMs - Date.now());
    if (ms <= 0) throw new StopError("payment request deadline reached; saved state retained");
    return ms;
  }
  async run<T>(work: (signal?: AbortSignal) => PromiseLike<T>): Promise<T> {
    const ms = this.remaining();
    if (ms === Infinity) return work();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new StopError("payment request deadline reached; saved state retained");
          controller.abort(error);
          reject(error);
        }, ms);
      });
      const value = await Promise.race([timeout, work(controller.signal)]);
      this.remaining();
      return value;
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
