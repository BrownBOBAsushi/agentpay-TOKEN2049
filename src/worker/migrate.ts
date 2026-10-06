import type { Db } from "./db";

export async function migrate(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS side_effect (
    task_id text,
    event_id text,
    action text,
    status text NOT NULL CHECK (status IN ('pending', 'done')),
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, event_id, action)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS mandate_nonce (
    payer text,
    nonce text,
    task_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (payer, nonce)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS task_journal (
    task_id text PRIMARY KEY,
    stage text NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query("ALTER TABLE task_journal ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'paid'))");
}
