import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** クラス名をつなぎ、Tailwind のクラスの重なりを後勝ちで解消する。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
