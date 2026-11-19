/** まだ作っていない画面に出す表示。 */
export function Placeholder({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-fg-sub">この画面はまだ作っていません。</p>
    </section>
  );
}
