export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerError";
  }
}

// Only application-owned fixed messages may reach the terminal. Driver errors can contain data.
export function formatWorkerFailure(error: unknown): string {
  return error instanceof WorkerError
    ? `worker_failed ${error.name}: ${error.message}`
    : "worker_failed Error: Worker operation failed";
}
