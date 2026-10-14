"use client";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import type { Branding } from "@/domain/branding";
import { MarketBrand, PoweredBy } from "./MarketBrand";
import { Icon, type IconName } from "./Icon";

export type NavItem = { href: string; label: string; exact?: boolean; icon?: IconName };

export function Sidebar({ items, footer, brand }: { items: NavItem[]; footer?: ReactNode; brand?: Branding | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <MarketBrand brand={brand} compact />
        <button
          ref={menuButton}
          type="button"
          aria-expanded={open}
          aria-controls="sidebar-nav"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium"
        >
          <Icon name={open ? "close" : "menu"} /> Menu
        </button>
      </div>
      <aside
        id="sidebar-nav"
        className={cx(
          "workspace-rail flex-col border-b border-border md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0",
          open ? "flex" : "hidden",
        )}
      >
        <div className="hidden px-6 pt-8 pb-7 md:block">
          <MarketBrand brand={brand} />
        </div>
        <p className="px-6 pt-4 pb-3 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">Área de gestão</p>
        <nav aria-label="Principal" className="flex flex-col gap-1.5 px-3 pb-5">
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
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-700 text-white shadow-sm"
                    : "text-muted hover:bg-subtle hover:text-fg",
                )}
              >
                {item.icon && <Icon name={item.icon} className="shrink-0" />}
                {item.label}
                {active && <Icon name="arrow" className="ml-auto size-4" />}
              </a>
            );
          })}
        </nav>
        <div className="mx-4 mt-auto rounded-2xl border border-brand-200 bg-brand-100/50 p-4 dark:border-brand-900 dark:bg-brand-950">
          <p className="text-sm font-semibold">Sua operação, conectada.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Estoque, vendas e autoatendimento em um só lugar.</p>
        </div>
        <div className="px-4 pt-5 pb-2"><PoweredBy /></div>
        {footer && <div className="mt-4 border-t border-border px-3 py-4">{footer}</div>}
      </aside>
    </>
  );
}
