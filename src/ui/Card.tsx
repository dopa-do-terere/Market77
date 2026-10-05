import type { ReactNode } from "react";
import { cx } from "./cx";

export function Card({ title, className, children }: { title?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface shadow-sm", className)}>
      {title && <h2 className="border-b border-border px-5 py-3.5 text-base font-semibold">{title}</h2>}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
