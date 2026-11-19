/** 小数の計算の誤差の許容幅(SPEC-002 の比べ方と同じ) */
const EPSILON = 1e-9;

/**
 * 損益などの円の金額を、画面に出すために1円未満で四捨五入する(SPEC-003 定義 7)。
 * 負の値は絶対値で四捨五入して符号を戻す(-86.5 は -87)。Math.round は -86 にする。
 * 計算どおりならちょうど x.5 になる値が、誤差で x.4999... になっても切り上がるように、
 * 許容幅を足してから丸める。
 */
export function roundYen(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) + EPSILON);
  // -0 を 0 にそろえる
  return rounded === 0 ? 0 : rounded;
}
