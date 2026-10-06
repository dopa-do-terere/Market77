import { message } from "@/lib/messages";
import { Alert, AuthShell, Button, Field, Input } from "@/ui";
import { signUpAction } from "./actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Criar conta">
      <div className="space-y-4">
        {error && <Alert tone="danger">{message(error)}</Alert>}
        <form action={signUpAction} className="space-y-4">
          <Field label="Nome da empresa"><Input name="orgName" required minLength={2} /></Field>
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha (mínimo 8 caracteres)"><Input name="password" type="password" required minLength={8} /></Field>
          <Button type="submit" className="w-full">Criar conta</Button>
        </form>
        <a href="/login" className="block text-center text-sm font-medium text-link hover:underline">
          Já tenho conta
        </a>
      </div>
    </AuthShell>
  );
}
