import type { Branding } from "@/domain/branding";
import { Icon } from "./Icon";
import { Logo } from "./Logo";

export function MarketBrand({ brand, compact = false }: { brand?: Branding | null; compact?: boolean }) {
  const name = brand?.name ?? "Seu mercado";
  return <div className={`flex min-w-0 items-center ${compact ? "gap-3" : "flex-col gap-3 text-center"}`}>
    {brand?.logoDataUrl ? <img src={brand.logoDataUrl} alt={`Logo de ${name}`} className={compact ? "h-10 w-14 shrink-0 object-contain" : "h-20 w-full max-w-48 object-contain"} />
      : <span className={`flex shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200 ${compact ? "size-10" : "size-16"}`}><Icon name="market" className={compact ? "size-5" : "size-8"} /></span>}
    <span className={`min-w-0 break-words font-semibold text-fg ${compact ? "text-sm" : "text-xl"}`}>{name}</span>
  </div>;
}

export function PoweredBy() {
  return <div className="flex items-center justify-center gap-2 text-[10px] text-muted"><span>Tecnologia</span><Logo className="h-4 w-auto" /></div>;
}
