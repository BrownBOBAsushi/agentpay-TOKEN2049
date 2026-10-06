export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerError";
  }
}

// Only application-owned or sanitized messages may reach the terminal. Driver errors can contain data.
export function workerErrorDetail(error: unknown): string {
  return error instanceof WorkerError ? `${error.name}: ${error.message}` : "Error: Worker operation failed";
}

export function formatWorkerFailure(error: unknown): string {
  return `worker_failed ${workerErrorDetail(error)}`;
}
