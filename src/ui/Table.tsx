import type { ReactNode } from "react";
import { cx } from "./cx";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-xl border border-border bg-surface shadow-sm", className)}>
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_th]:bg-subtle [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted">
        {children}
      </table>
    </div>
  );
}
