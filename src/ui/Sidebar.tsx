"use client";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "./cx";
import { Logo } from "./Logo";

export type NavItem = { href: string; label: string; exact?: boolean };

export function Sidebar({ items, footer }: { items: NavItem[]; footer?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <Logo className="h-6 w-auto" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sidebar-nav"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
        >
          Menu
        </button>
      </div>
      <aside
        id="sidebar-nav"
        className={cx(
          "border-b border-border bg-surface md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0",
          open ? "block" : "hidden",
        )}
      >
        <div className="hidden px-5 py-6 md:block">
          <Logo className="h-7 w-auto" />
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1 px-3 py-3 md:py-0">
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                    : "text-muted hover:bg-subtle hover:text-fg",
                )}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        {footer && <div className="px-3 py-4">{footer}</div>}
      </aside>
    </>
  );
}
