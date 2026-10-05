"use client";
import { useActionState } from "react";
import { type CreateTerminalState, createTerminalAction } from "./actions";

export function TerminalForm({ orgId, markets }: { orgId: string; markets: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<CreateTerminalState, FormData>(
    createTerminalAction.bind(null, orgId),
    {},
  );
  return (
    <section>
      <form action={formAction}>
        <label>
          Nome do totem <input name="name" required minLength={2} maxLength={60} />
        </label>{" "}
        <label>
          Mercado{" "}
          <select name="marketId" required>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          ID da maquininha Point (opcional){" "}
          <input name="pointDeviceId" maxLength={64} pattern="[\x21-\x7e]+" title="Sem espaços" />
        </label>{" "}
        <button type="submit" disabled={pending || markets.length === 0}>
          Cadastrar totem
        </button>
      </form>
      {state.error && <p role="alert">{state.error}</p>}
      {state.token && (
        <div role="status">
          <p>
            Totem <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code style={{ wordBreak: "break-all" }}>{state.token}</code>
        </div>
      )}
    </section>
  );
}
