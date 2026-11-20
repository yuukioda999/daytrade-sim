import { runTick, safeErrorLabel } from "@/application/worker-service";
import { DEFAULT_DB_PATH, openDatabase } from "@/infrastructure/db/database";
import { sqliteRepositories } from "@/infrastructure/db/sqlite-repositories";
import { createMarketDataSource } from "@/infrastructure/market-data-factory";

/**
 * 自動の練習売買のプロセス(ADR-0007、ADR-0009)。`npm run worker` で起動する。
 * 1分ごとに、今日の足を取って今日の記録を作り直す。画面のサーバーと同じ DB を使う。
 * リポジトリのフォルダで起動する(DB の場所は画面のサーバーと同じく、起動したフォルダの data/ から決まる)
 */
const TICK_MS = 60_000;
/** 毎分 0 秒ちょうどではなく、少しずらして動く(足がそろうのを待つ) */
const OFFSET_MS = 5_000;

const repos = sqliteRepositories(openDatabase(process.env.DAYTRADE_DB_PATH || DEFAULT_DB_PATH));
const source = createMarketDataSource();

let running = false;
let stopping = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (running) return; // 前の回が終わっていなければ飛ばす(同時に2回動かない)
  running = true;
  try {
    await runTick({ repos, source }, new Date());
  } catch (e) {
    console.error(safeErrorLabel(e));
  } finally {
    running = false;
  }
}

function scheduleNext(): void {
  if (stopping) return;
  const now = Date.now();
  const next = Math.ceil((now - OFFSET_MS) / TICK_MS) * TICK_MS + OFFSET_MS;
  timer = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, Math.max(1_000, next - now));
}

function stop(): void {
  stopping = true;
  if (timer) clearTimeout(timer);
  console.log("自動売買のプロセスを止めます");
  // 処理の途中なら、終わるのを待ってから閉じる
  const wait = setInterval(() => {
    if (!running) {
      clearInterval(wait);
      process.exit(0);
    }
  }, 200);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`自動売買のプロセスを始めます(${source.isTestSource ? "テスト用の取得元" : "Alpaca"})。止める時は Ctrl+C`);
void tick().then(scheduleNext);
