import { notFound } from "next/navigation";
import { DashboardOverview } from "@/ui/DashboardOverview";
import { Sidebar } from "@/ui";

// Isolated visual fixture: never loads tenant data and never exists in production.
export default function DashboardPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen md:flex">
      <Sidebar items={[
        { href: "/ui/dashboard", label: "Painel", icon: "dashboard", exact: true },
        { href: "/ui", label: "Componentes", icon: "product", exact: true },
        { href: "/login", label: "Tela de entrada", icon: "team" },
      ]} />
      <div className="min-w-0 flex-1">
        <div className="border-b border-border bg-surface px-4 py-5 text-xs font-medium text-muted md:px-10">Prévia de design · Dados ilustrativos · Apenas em desenvolvimento</div>
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-10 md:py-10">
          <DashboardOverview base="/ui/dashboard" canCreateMarket={false} today={{ totalCents: 248750, count: 87 }} offline={1} fiscalErrors={0} markets={[
            { id: "aurora", name: "Residencial Aurora", address: "Rua das Palmeiras, 120", lowCount: 3, expired: 0 },
            { id: "jardins", name: "Condomínio Jardins", address: "Av. Central, 850", lowCount: 0, expired: 0 },
            { id: "parque", name: "Parque das Flores", address: "Rua dos Ipês, 42", lowCount: 2, expired: 1 },
          ]} />
        </div>
      </div>
    </div>
  );
}
