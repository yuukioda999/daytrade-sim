"use client";

import { useEffect, useRef } from "react";

/**
 * Recharts 3 は線や目盛りを重ねる順のために、React のポータルで <g> の層を作る。
 * React はポータルの入れ物にフォーカスのイベントを登録し、Chrome はフォーカスのイベントを持つ
 * SVG の要素を Tab で止まる先にする。その結果、意味のない止まり先が4つできる(PR のレビュー 5)。
 * 層に tabindex="-1" を付けて、Tab の順番から外す。マウスの吹き出しはそのまま動く。
 */
export function useRemoveChartLayersFromTabOrder() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fix = () => {
      root.querySelectorAll('svg g[class*="recharts-zIndex-layer"]:not([tabindex])').forEach((g) => {
        g.setAttribute("tabindex", "-1");
      });
    };
    fix();
    const observer = new MutationObserver(fix);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return ref;
}
