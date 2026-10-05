import { headers } from "next/headers";
import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { mercadoPagoStatus } from "@/domain/credentials";
import { message } from "@/lib/messages";
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
    <main>
      <h1>Pagamentos (Mercado Pago)</h1>
      {error && <p role="alert">{message(error)}</p>}
      {ok && OK[ok] && <p role="status">{OK[ok]}</p>}
      <p>
        {status.configured
          ? `Conectado. Token terminando em ${status.last4}, atualizado em ${status.updatedAt?.toLocaleString("pt-BR")}.`
          : "Não conectado. Os pagamentos usam o simulador."}
      </p>
      <form action={saveCredentialsAction.bind(null, orgId)}>
        <label>
          Access token <input name="accessToken" type="password" required autoComplete="off" />
        </label>{" "}
        <label>
          Segredo do webhook <input name="webhookSecret" type="password" required autoComplete="off" />
        </label>{" "}
        <button type="submit">{status.configured ? "Trocar credenciais" : "Salvar credenciais"}</button>
      </form>
      {status.configured && (
        <>
          <form action={testCredentialsAction.bind(null, orgId)} style={{ display: "inline" }}>
            <button type="submit">Testar</button>
          </form>{" "}
          <form action={removeCredentialsAction.bind(null, orgId)} style={{ display: "inline" }}>
            <button type="submit">Remover</button>
          </form>
        </>
      )}
      <h2>URLs de webhook</h2>
      <p>No painel do Mercado Pago, cadastre estas URLs (eventos de pagamento no Pix e de order no cartão) e copie o segredo gerado para o campo acima.</p>
      <ul>
        <li>
          Pix: <code>{`${base}/api/webhooks/pix/mercadopago/${orgId}`}</code>
        </li>
        <li>
          Cartão: <code>{`${base}/api/webhooks/card/mercadopago/${orgId}`}</code>
        </li>
      </ul>
    </main>
  );
}
