import { headers } from "next/headers";
import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { mercadoPagoStatus } from "@/domain/credentials";
import { message } from "@/lib/messages";
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from "@/ui";
import { removeCredentialsAction, saveCredentialsAction, testCredentialsAction } from "./actions";

const OK: Record<string, string> = {
  saved: "Credenciais salvas.",
  removed: "Credenciais removidas. Os pagamentos voltam ao simulador.",
  tested: "O Mercado Pago aceitou o token.",
};

export default async function PaymentsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { orgId } = await params;
  const { error, ok } = await searchParams;
  await requireOrgPage(orgId, "payment:write");
  const status = await withOrg(orgId, (tx) => mercadoPagoStatus(tx));
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  return (
    <main className="space-y-6">
      <PageHeader title="Pagamentos (Mercado Pago)" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      {ok && OK[ok] && <Alert tone="success">{OK[ok]}</Alert>}
      <Card title="Conexão">
        <p className="mb-4 flex flex-wrap items-center gap-2">
          {status.configured ? (
            <>
              <Badge tone="success">Conectado</Badge>
              <span className="text-muted">
                Token terminando em {status.last4}, atualizado em {status.updatedAt?.toLocaleString("pt-BR")}.
              </span>
            </>
          ) : (
            <>
              <Badge tone="neutral">Não conectado</Badge>
              <span className="text-muted">Os pagamentos usam o simulador.</span>
            </>
          )}
        </p>
        <form action={saveCredentialsAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-2">
          <Field label="Access token">
            <Input name="accessToken" type="password" required autoComplete="off" />
          </Field>
          <Field label="Segredo do webhook">
            <Input name="webhookSecret" type="password" required autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">{status.configured ? "Trocar credenciais" : "Salvar credenciais"}</Button>
          </div>
        </form>
        {status.configured && (
          <div className="mt-4 flex gap-2">
            <form action={testCredentialsAction.bind(null, orgId)}>
              <Button type="submit" variant="secondary">Testar</Button>
            </form>
            <form action={removeCredentialsAction.bind(null, orgId)}>
              <Button type="submit" variant="secondary">Remover</Button>
            </form>
          </div>
        )}
      </Card>
      <Card title="URLs de webhook">
        <p className="mb-3 text-muted">
          No painel do Mercado Pago, cadastre esta URL e ative os dois tópicos nela: Pagamentos (Pix) e Orders (Mercado Pago, cartão). Copie o segredo gerado para o campo acima.
        </p>
        <code className="block break-all rounded-md bg-subtle px-3 py-2 text-sm">{`${base}/api/webhooks/mercadopago/${orgId}`}</code>
      </Card>
    </main>
  );
}
