import type { Bar } from "@/domain/market/bar";
import { toEastern } from "@/domain/market/eastern-time";
import { sessionOn } from "@/domain/market/market-calendar";

/** 過去の1取引日分の足(取り終えた日だけを渡す) */
export type PastDay = { date: string; bars: readonly Bar[] };

/**
 * 足 target と同じ時刻(米国東部時間)に始まる、過去の取引日の取引量(古い順。SPEC-002 定義 4)。
 * - 短縮取引日などで、その時刻に市場が閉まっていた日は数えない
 * - 市場は開いていたが、その時刻の足がない日は 0 として数える
 * 渡す日は「取り終えた日」だけにする(取っていない日を 0 と数えないため)
 */
export function sameTimeVolumes(pastDays: readonly PastDay[], target: Date): number[] {
  const { hour, minute } = toEastern(target);
  // 取引開始(09:30)からの分。どの日も取引開始は米国東部時間の 09:30 なので、その日の取引開始に足せば同じ時刻になる
  // (日ごとに時刻を変換し直すより速い。過去データで試す時に何万回も呼ぶため。T11)
  const sinceOpenMs = ((hour - 9) * 60 + (minute - 30)) * 60_000;
  const result: number[] = [];
  for (const day of [...pastDays].sort((a, b) => a.date.localeCompare(b.date))) {
    const session = sessionOn(day.date);
    if (!session) continue;
    const t = session.open.getTime() + sinceOpenMs;
    if (t < session.open.getTime() || t >= session.close.getTime()) continue;
    const bar = day.bars.find((b) => b.start.getTime() === t);
    result.push(bar ? bar.volume : 0);
  }
  return result;
}
