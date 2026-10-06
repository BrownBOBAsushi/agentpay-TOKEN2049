import { Pool } from "pg";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function createPgDb(databaseUrl: string): Db & { close(): Promise<void> } {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params);
      return { rows: result.rows as T[] };
    },
    close: () => pool.end(),
  };
}
