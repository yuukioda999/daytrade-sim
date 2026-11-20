import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blend, contrastRatio, parseThemeColors } from "./contrast";

const css = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);
const colors = parseThemeColors(css);

/** 画面で使う「文字の色 / 背景の色」の組み合わせ。足したらここにも足す。 */
const TEXT_PAIRS: ReadonlyArray<[fg: string, bg: string]> = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["fg", "surface-2"],
  ["fg", "muted"],
  ["fg-sub", "bg"],
  ["fg-sub", "surface"],
  ["fg-sub", "muted"],
  ["fg-muted", "bg"],
  ["fg-muted", "surface"],
  ["fg-muted", "surface-2"],
  ["accent-soft", "surface"],
  ["up", "surface"],
  ["up", "surface-2"],
  ["down", "surface"],
  ["down", "surface-2"],
  ["warn", "surface"],
  ["accent-fg", "accent"],
  // shadcn/ui の部品の色の名前(T6)
  ["primary-foreground", "primary"],
  ["card-foreground", "card"],
  ["muted-foreground", "card"],
  ["foreground", "background"],
  ["warn-fg", "warn"],
];

/** 文字ではない目印(今いる画面の下線など)と、その背景。WCAG の 3:1 で確かめる。 */
const NON_TEXT_PAIRS: ReadonlyArray<[mark: string, bg: string]> = [
  ["accent", "muted"],
  ["accent", "surface-2"],
  // スイッチのオフ、スライダーのつまみの縁(T6)
  ["input", "surface"],
  ["input", "card"],
  ["primary", "card"],
  ["primary", "muted"],
  // スイッチのつまみ(オフの時)
  ["foreground", "input"],
  // シミュレーターのグラフの3本の線(AC-005-07)
  ["accent", "card"],
  ["warn", "card"],
  ["fg", "card"],
  // 設定の画面の入力欄の枠(T7)
  ["input", "surface-2"],
];

/** 半透明の背景(背景の色 / 不透明度)の上の文字。ヘッダーの市場の状態の表示で使う。 */
const TINTED_PAIRS: ReadonlyArray<[fg: string, tint: string, alpha: number, base: string]> = [
  ["up", "up", 0.15, "surface-2"],
  ["warn", "warn", 0.15, "surface-2"],
  // 設定の画面の「設定済み」と、自動売買が止まっている理由の欄(T7)
  ["up", "up", 0.15, "surface"],
  ["fg", "warn", 0.15, "surface"],
];

describe("テーマの色", () => {
  it.each(TINTED_PAIRS)(
    "AC-007-03: 文字 %s と背景(%s を %s で surface-2 に重ねた色)の比が 4.5:1 以上",
    (fg, tint, alpha, base) => {
      const bg = blend(colors[tint], colors[base], alpha);
      expect(contrastRatio(colors[fg], bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("AC-007-03: 色を重ねる計算が合う(白を 50% で黒に重ねると #808080)", () => {
    expect(blend("#ffffff", "#000000", 0.5)).toBe("#808080");
  });

  it("AC-007-03: 計算が WCAG の既知の値と合う(白と黒は 21:1)", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it.each(TEXT_PAIRS)(
    "AC-007-03: 文字 %s と背景 %s の比が 4.5:1 以上",
    (fg, bg) => {
      expect(colors[fg], `--color-${fg} が globals.css にない`).toBeDefined();
      expect(colors[bg], `--color-${bg} が globals.css にない`).toBeDefined();
      expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(NON_TEXT_PAIRS)(
    "AC-007-03: 目印 %s と背景 %s の比が 3:1 以上",
    (mark, bg) => {
      expect(colors[mark], `--color-${mark} が globals.css にない`).toBeDefined();
      expect(colors[bg], `--color-${bg} が globals.css にない`).toBeDefined();
      expect(contrastRatio(colors[mark], colors[bg])).toBeGreaterThanOrEqual(3);
    },
  );
});
