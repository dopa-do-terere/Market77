"use client";
import { useActionState } from "react";
import { type CreateSourceState, createAccessSourceAction } from "./actions";

export function AccessSourceForm({ orgId, marketId }: { orgId: string; marketId: string }) {
  const [state, formAction, pending] = useActionState<CreateSourceState, FormData>(
    createAccessSourceAction.bind(null, orgId, marketId),
    {},
  );
  return (
    <section>
      <form action={formAction}>
        <label>
          Nome do leitor <input name="name" required minLength={2} maxLength={60} />
        </label>{" "}
        <button type="submit" disabled={pending}>
          Cadastrar leitor
        </button>
      </form>
      {state.error && <p role="alert">{state.error}</p>}
      {state.token && (
        <div role="status">
          <p>
            Leitor <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code style={{ wordBreak: "break-all" }}>{state.token}</code>
        </div>
      )}
    </section>
  );
}
