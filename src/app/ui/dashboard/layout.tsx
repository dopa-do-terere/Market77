import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Sidebar } from "@/ui";

export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen md:flex">
      <Sidebar items={[
        { href: "/ui/dashboard", label: "Painel", icon: "dashboard", exact: true },
        { href: "/ui/dashboard/markets", label: "Mercados", icon: "market" },
        { href: "/ui/dashboard/products", label: "Produtos", icon: "product" },
        { href: "/ui/dashboard/sales", label: "Vendas", icon: "sales" },
        { href: "/ui/dashboard/terminals", label: "Totens", icon: "terminal" },
        { href: "/ui/dashboard/settings/payments", label: "Pagamentos", icon: "payment" },
        { href: "/ui/dashboard/team", label: "Equipe", icon: "team" },
        { href: "/ui/pdv", label: "Prévia do PDV", icon: "scan" },
        { href: "/ui", label: "Componentes", icon: "product", exact: true },
      ]} />
      <div className="min-w-0 flex-1">
        <div className="border-b border-border bg-surface px-4 py-5 text-xs font-medium text-muted md:px-10">Prévia de design · Dados ilustrativos · Ações de cadastro desabilitadas · Apenas em desenvolvimento</div>
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-10 md:py-10">{children}</div>
      </div>
    </div>
  );
}
