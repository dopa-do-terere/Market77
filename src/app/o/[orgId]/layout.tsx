import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
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
  return (
    <div>
      <nav>
        <a href={base}>Painel</a> <a href={`${base}/markets`}>Mercados</a>{" "}
        <a href={`${base}/products`}>Produtos</a>{" "}
        {can(role, "member:write") && <a href={`${base}/team`}>Equipe</a>}
        <form action={logoutAction} style={{ display: "inline" }}>
          <button type="submit">Sair</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
