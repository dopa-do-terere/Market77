import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { Button, Icon, type NavItem, Sidebar } from "@/ui";
import { logoutAction } from "./actions";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { role } = await requireOrgPage(orgId);
  const base = `/o/${orgId}`;
  const items: NavItem[] = [
    { href: base, label: "Painel", exact: true, icon: "dashboard" },
    { href: `${base}/markets`, label: "Mercados", icon: "market" },
    { href: `${base}/products`, label: "Produtos", icon: "product" },
    ...(can(role, "sale:read") ? [{ href: `${base}/sales`, label: "Vendas", icon: "sales" as const }] : []),
    ...(can(role, "terminal:write") ? [{ href: `${base}/terminals`, label: "Totens", icon: "terminal" as const }] : []),
    ...(can(role, "payment:write") ? [{ href: `${base}/settings/payments`, label: "Pagamentos", icon: "payment" as const }] : []),
    ...(can(role, "member:write") ? [{ href: `${base}/team`, label: "Equipe", icon: "team" as const }] : []),
  ];
  return (
    <div className="min-h-screen md:flex">
      <a href="#workspace-content" className="sr-only fixed top-4 left-4 z-50 rounded-lg bg-surface p-3 focus:not-sr-only">Pular para o conteúdo</a>
      <Sidebar
        items={items}
        footer={
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="w-full justify-start">
              <Icon name="logout" /> Sair da conta
            </Button>
          </form>
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-10">
          <span className="text-sm text-muted">Workspace <span className="mx-2 text-border">/</span> <span className="font-medium text-fg">Gestão</span></span>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted">{role === "owner" ? "Administrador" : role === "manager" ? "Gerente" : "Repositor"}</span>
        </div>
        <div id="workspace-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 md:px-10 md:py-10">{children}</div>
      </div>
    </div>
  );
}
