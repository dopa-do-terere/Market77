import { message } from "@/lib/messages";
import { Alert, AuthShell, Button, Field, Input } from "@/ui";
import { loginAction } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Entrar">
      <div className="space-y-4">
        {error && <Alert tone="danger">{message(error)}</Alert>}
        <form action={loginAction} className="space-y-4">
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha"><Input name="password" type="password" required /></Field>
          <Button type="submit" className="w-full">Entrar</Button>
        </form>
        <a href="/signup" className="block text-center text-sm font-medium text-link hover:underline">
          Criar conta
        </a>
      </div>
    </AuthShell>
  );
}
