import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
const variants = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  secondary: "border border-border bg-surface text-fg hover:bg-subtle",
  ghost: "text-fg hover:bg-subtle",
};
const sizes = {
  md: "h-9 px-3.5 text-sm",
  touch: "min-h-16 rounded-xl px-8 text-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return <button className={cx(base, variants[variant], sizes[size], className)} {...rest} />;
}
