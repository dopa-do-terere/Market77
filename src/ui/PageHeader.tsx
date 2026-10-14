import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <header className={icon ? "flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-border bg-subtle p-6 md:p-8" : "flex flex-wrap items-end justify-between gap-4"}>
      <div className="flex min-w-0 items-start gap-4">
        {icon && <span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-sm sm:flex"><Icon name={icon} className="size-7" /></span>}
        <div className="min-w-0">
          {icon && <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-link uppercase">Market77 · Gestão</p>}
          <h1 className="break-words text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted md:text-base">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
