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
      <PageHeader title="Equipe" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      {ok && <Alert tone="success">Membro adicionado.</Alert>}
      <Card title="Adicionar membro">
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
