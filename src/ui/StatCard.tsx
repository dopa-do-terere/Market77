import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function StatCard({ label, value, note, icon, featured = false }: {
  label: string; value: ReactNode; note: string; icon: IconName; featured?: boolean;
}) {
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${featured ? "metric-featured" : "border-border bg-surface"}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">{label}</h2>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${featured ? "bg-white/10 text-brand-200" : "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"}`}><Icon name={icon} /></span>
      </div>
      <p className="mt-4 break-words text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p>
    </section>
  );
}
