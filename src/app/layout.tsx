import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  title: {
    default: "デイトレ支援シミュレーター",
    template: "%s | デイトレ支援シミュレーター",
  },
  description:
    "米国株デイトレードのルールを、実際の市場データで練習売買して検証するアプリ。投資助言ではありません。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
        >
          本文へ移動
        </a>
        <SiteHeader />
        {/* tabIndex={-1}: 本文へ移動のリンクで、フォーカスを本文に移すため */}
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1392px] flex-1 p-6 focus:outline-none"
        >
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
