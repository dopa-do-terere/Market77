"use client";
import { useActionState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/ui";
import { type CreateTerminalState, createTerminalAction } from "./actions";

export function TerminalForm({ orgId, markets }: { orgId: string; markets: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<CreateTerminalState, FormData>(
    createTerminalAction.bind(null, orgId),
    {},
  );
  return (
    <Card icon="plus" title="Novo totem" description="Vincule o equipamento a um mercado para iniciar a operação.">
      <form action={formAction} className="grid gap-4 sm:grid-cols-3">
        <Field label="Nome do totem">
          <Input name="name" required minLength={2} maxLength={60} />
        </Field>
        <Field label="Mercado">
          <Select name="marketId" required>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ID da maquininha Point (opcional)">
          <Input name="pointDeviceId" maxLength={64} pattern="[\x21-\x7e]+" title="Sem espaços" />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={pending || markets.length === 0}>
            Cadastrar totem
          </Button>
        </div>
      </form>
      {state.error && (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      )}
      {state.token && (
        <Alert tone="success" className="mt-4">
          <p>
            Totem <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-sm text-fg">{state.token}</code>
        </Alert>
      )}
    </Card>
  );
}
