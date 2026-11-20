import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** 既定の DB ファイル。data/ はコミットしない(.gitignore、ADR-0003) */
export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "daytrade.db");
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * DB を開き、マイグレーションを当てる。":memory:" はテスト用。
 * 自動売買のプロセス(T9)と画面のプロセスが同じファイルを使うので、WAL にする(ADR-0003)
 */
export function openDatabase(file: string = DEFAULT_DB_PATH): Db {
  const onDisk = file !== ":memory:";
  // 接続用キーを平文で保存するので、フォルダとファイルは自分だけが読める権限にする(T7 のセキュリティレビュー)
  if (onDisk) mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const sqlite = new Database(file);
  // 別のプロセスが書いている間は、少し待ってから書く。WAL への切り替えやマイグレーションより先に設定する
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  if (onDisk) restrictPermissions(file);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

function restrictPermissions(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    if (existsSync(f)) chmodSync(f, 0o600);
  }
}
