import type { HTMLAttributes } from "react";
import { cx } from "./cx";

const tones = {
  info: "border-sky-600 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  success: "border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100",
  warning: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  danger: "border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100",
};

export function Alert({
  tone = "info",
  className,
  role,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  const implied = tone === "danger" || tone === "warning" ? "alert" : "status";
  return <div role={role ?? implied} className={cx("rounded-lg border-l-4 px-4 py-3", tones[tone], className)} {...rest} />;
}
