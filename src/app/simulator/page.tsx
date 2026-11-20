import type { Metadata } from "next";
import { SimulatorView } from "@/components/simulator/simulator-view";

export const metadata: Metadata = { title: "シミュレーター" };

export default function Page() {
  return <SimulatorView />;
}
