import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "./cx";

const control =
  "rounded-lg border bg-surface text-fg shadow-xs transition-colors placeholder:text-muted hover:border-muted focus:outline-2 focus:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cx("block space-y-1.5 [&>input]:w-full [&>select]:w-full", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Input({
  invalid,
  touch,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; touch?: boolean }) {
  return (
    <input
      className={cx(
        control,
        touch ? "h-16 rounded-xl px-5 text-2xl" : "h-10 px-3 text-sm",
        invalid ? "border-red-600" : "border-border",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cx(control, "h-10 px-3 text-sm", invalid ? "border-red-600" : "border-border", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx("flex items-center gap-2 text-sm font-medium", className)}>
      <input type="checkbox" className="size-4 accent-brand-600" {...rest} />
      {label}
    </label>
  );
}
