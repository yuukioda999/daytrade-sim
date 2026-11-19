/** 全画面の下部に出す免責の表示(SPEC-007 AC-007-01)。 */
export const DISCLAIMER =
  "本アプリは技術検証とシミュレーションが目的で、投資助言・推奨ではありません。";

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1392px] px-6 pb-6 text-xs text-fg-muted">
      <p data-testid="disclaimer">{DISCLAIMER}</p>
    </footer>
  );
}
