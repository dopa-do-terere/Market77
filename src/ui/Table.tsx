import type { ReactNode } from "react";
import { cx } from "./cx";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm", className)}>
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-5 [&_td]:py-4 [&_td]:align-top [&_th]:bg-subtle [&_th]:px-5 [&_th]:py-3.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-muted [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-subtle">
        {children}
      </table>
    </div>
  );
}
