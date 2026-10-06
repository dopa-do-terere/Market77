"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/ui";
import { type CreateSourceState, createAccessSourceAction } from "./actions";

export function AccessSourceForm({ orgId, marketId }: { orgId: string; marketId: string }) {
  const [state, formAction, pending] = useActionState<CreateSourceState, FormData>(
    createAccessSourceAction.bind(null, orgId, marketId),
    {},
  );
  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field label="Nome do leitor">
          <Input name="name" required minLength={2} maxLength={60} />
        </Field>
        <Button type="submit" disabled={pending}>
          Cadastrar leitor
        </Button>
      </form>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.token && (
        <Alert tone="success">
          <p>
            Leitor <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-sm text-fg">{state.token}</code>
        </Alert>
      )}
    </div>
  );
}
