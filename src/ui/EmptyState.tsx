import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function EmptyState({ icon, title, description, actions }: {
  icon: IconName; title: string; description: string; actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"><Icon name={icon} className="size-7" /></span>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {actions && <div className="mt-5">{actions}</div>}
    </div>
  );
}
