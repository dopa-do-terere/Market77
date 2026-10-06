import type { ReactNode } from "react";
import { cx } from "./cx";

export function Card({ title, className, children }: { title?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-border bg-surface shadow-sm", className)}>
      {title && <h2 className="border-b border-border px-6 py-5 text-base font-semibold tracking-tight">{title}</h2>}
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
