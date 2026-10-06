import type { ReactNode } from "react";
import { cx } from "./cx";

export function Table({ children, className, title, description }: { children: ReactNode; className?: string; title?: string; description?: string }) {
  return (
    <div role={title ? "region" : undefined} aria-label={title} tabIndex={title ? 0 : undefined} className={cx("overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm", className)}>
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-5 [&_td]:py-4 [&_td]:align-top [&_th]:bg-subtle [&_th]:px-5 [&_th]:py-3.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-muted [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-subtle">
        {title && <caption className="border-b border-border px-6 py-5 text-left"><span className="text-base font-semibold">{title}</span>{description && <span className="mt-1 block text-sm text-muted">{description}</span>}</caption>}
        {children}
      </table>
    </div>
  );
}
