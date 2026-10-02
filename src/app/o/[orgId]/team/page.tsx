import { requireOrgPage } from "@/auth/guard";
import { message } from "@/lib/messages";
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
    <main>
      <h1>Equipe</h1>
      {error && <p role="alert">{message(error)}</p>}
      {ok && <p>Membro adicionado.</p>}
      <form action={addMemberAction.bind(null, orgId)}>
        <label>E-mail <input name="email" type="email" required /></label>
        <label>Senha inicial (só para usuário novo) <input name="password" type="password" minLength={8} /></label>
        <label>
          Papel{" "}
          <select name="role">
            <option value="manager">Gerente</option>
            <option value="restocker">Repositor</option>
          </select>
        </label>
        <button type="submit">Adicionar</button>
      </form>
    </main>
  );
}
