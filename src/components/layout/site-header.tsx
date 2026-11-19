"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { NAV_ITEMS } from "./nav-items";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface-2 px-6 py-2">
      <p className="text-[15px] font-bold">デイトレ支援シミュレーター</p>
      <nav aria-label="メイン">
        <ul className="flex flex-wrap gap-1">
          {NAV_ITEMS.map((item) => {
            const current = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-lg px-3.5",
                    current
                      ? "bg-muted font-semibold text-fg"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
