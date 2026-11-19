import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseThemeColors } from "./contrast";

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
  ["warn-fg", "warn"],
];

/** 文字ではない目印(今いる画面の下線など)と、その背景。WCAG の 3:1 で確かめる。 */
const NON_TEXT_PAIRS: ReadonlyArray<[mark: string, bg: string]> = [
  ["accent", "muted"],
  ["accent", "surface-2"],
];

describe("テーマの色", () => {
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
