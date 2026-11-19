/** 5分足1本。価格はドル、取引量は株数。 */
export type Bar = {
  /** 足が始まった時刻 */
  start: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** その足の平均約定価格。データ提供元が出さない時は undefined */
  vwap?: number;
};
