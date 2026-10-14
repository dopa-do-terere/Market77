import type { ReactNode } from "react";
import { cx } from "./cx";

export type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted ring-border dark:bg-subtle dark:text-muted",
  success: "bg-green-100 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-300 dark:ring-green-900",
  warning: "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  danger: "bg-red-100 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  brand: "bg-brand-100 text-brand-800 ring-brand-200 dark:bg-brand-950 dark:text-brand-200 dark:ring-brand-900",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
