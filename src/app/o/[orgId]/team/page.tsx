import { requireOrgPage } from "@/auth/guard";
import { message } from "@/lib/messages";
import { Alert, Button, Card, Field, Input, PageHeader, Select } from "@/ui";
import { addMemberAction } from "./actions";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { orgId } = await params;
  const { error, ok } = await searchParams;
  await requireOrgPage(orgId, "member:write");
  return (
    <main className="space-y-6">
      <PageHeader icon="team" title="Equipe" description="Compartilhe a operação com quem cuida dos seus mercados." />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      {ok && <Alert tone="success">Membro adicionado.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card icon="team" title="Gerente"><p className="text-sm leading-relaxed text-muted">Gerencia produtos, preços e estoque, além de acompanhar as vendas.</p></Card>
        <Card icon="product" title="Repositor"><p className="text-sm leading-relaxed text-muted">Consulta produtos e estoque e registra as movimentações da reposição.</p></Card>
      </div>
      <Card icon="plus" title="Adicionar membro" description="Defina o acesso de cada pessoa conforme sua função.">
        <form action={addMemberAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-3">
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha inicial"><Input name="password" type="password" minLength={8} required /></Field>
          <Field label="Papel">
            <Select name="role">
              <option value="manager">Gerente</option>
              <option value="restocker">Repositor</option>
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit">Adicionar</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
