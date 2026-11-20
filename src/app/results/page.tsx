import type { Metadata } from "next";
import { ResultsView } from "@/components/results/results-view";

export const metadata: Metadata = { title: "成績" };

export default function Page() {
  return <ResultsView />;
}
