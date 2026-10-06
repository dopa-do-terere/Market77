import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export function Card({ title, description, icon, className, children }: { title?: ReactNode; description?: string; icon?: IconName; className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-border bg-surface shadow-sm", className)}>
      {title && <div className="flex items-center gap-3 border-b border-border px-6 py-5">
        {icon && <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-link"><Icon name={icon} /></span>}
        <div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{description && <p className="mt-1 text-sm text-muted">{description}</p>}</div>
      </div>}
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
