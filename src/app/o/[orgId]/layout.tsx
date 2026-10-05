import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { Button, type NavItem, Sidebar } from "@/ui";
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
    { href: base, label: "Painel", exact: true },
    { href: `${base}/markets`, label: "Mercados" },
    { href: `${base}/products`, label: "Produtos" },
    ...(can(role, "sale:read") ? [{ href: `${base}/sales`, label: "Vendas" }] : []),
    ...(can(role, "terminal:write") ? [{ href: `${base}/terminals`, label: "Totens" }] : []),
    ...(can(role, "payment:write") ? [{ href: `${base}/settings/payments`, label: "Pagamentos" }] : []),
    ...(can(role, "member:write") ? [{ href: `${base}/team`, label: "Equipe" }] : []),
  ];
  return (
    <div className="min-h-screen md:flex">
      <Sidebar
        items={items}
        footer={
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="w-full justify-start">
              Sair
            </Button>
          </form>
        }
      />
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-10 md:py-10">{children}</div>
      </div>
    </div>
  );
}
