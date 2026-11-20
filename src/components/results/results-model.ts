/** 軸の端を、0から遠い側の切りのよい円の値にする(-86 は -90、1,234 は 2,000、1円未満は 1円) */
export function roundAway(v: number): number {
  if (v === 0) return 0;
  const abs = Math.abs(v);
  const step = abs < 1 ? 1 : 10 ** Math.floor(Math.log10(abs));
  return Math.sign(v) * Math.ceil(abs / step) * step;
}

/**
 * 日ごとの損益の棒グラフの軸(AC-004-06)。0円を必ず入れ、両端は切りのよい値にする。
 * 端の半分の値が整数の円になる時だけ、その位置にも目盛りを置く(-3円の半分の -1.5 は置かない)
 */
export function pnlAxis(values: readonly number[]): { domain: [number, number]; ticks: number[] } {
  const lo = values.length === 0 ? 0 : Math.min(0, roundAway(Math.min(...values)));
  const hi = values.length === 0 ? 0 : Math.max(0, roundAway(Math.max(...values)));
  const candidates = [lo, lo / 2, 0, hi / 2, hi].filter((t) => Number.isInteger(t));
  // 損益がすべて 0円の日だけの時も、軸に幅を持たせる
  const domain: [number, number] = lo === 0 && hi === 0 ? [-1, 1] : [lo, hi];
  const ticks = [...new Set(candidates.map((t) => (Object.is(t, -0) ? 0 : t)))].sort((a, b) => a - b);
  return { domain, ticks };
}
