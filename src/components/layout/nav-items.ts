export type NavItem = {
  href: "/" | "/trades" | "/results" | "/simulator" | "/settings";
  label: string;
};

/** 上部のメニュー(SPEC-007 AC-007-02)。並びはワイヤーフレームのとおり。 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "ダッシュボード" },
  { href: "/trades", label: "自動売買の記録" },
  { href: "/results", label: "成績" },
  { href: "/simulator", label: "シミュレーター" },
  { href: "/settings", label: "設定" },
];
