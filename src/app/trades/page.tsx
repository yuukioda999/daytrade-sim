import type { Metadata } from "next";
import { TradesView } from "@/components/dashboard/trades-view";

export const metadata: Metadata = { title: "自動売買の記録" };

export default function Page() {
  return <TradesView />;
}
