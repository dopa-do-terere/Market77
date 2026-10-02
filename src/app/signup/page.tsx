import { message } from "@/lib/messages";
import { signUpAction } from "./actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Criar conta</h1>
      {error && <p role="alert">{message(error)}</p>}
      <form action={signUpAction}>
        <label>Nome da empresa <input name="orgName" required minLength={2} /></label>
        <label>E-mail <input name="email" type="email" required /></label>
        <label>Senha (mínimo 8 caracteres) <input name="password" type="password" required minLength={8} /></label>
        <button type="submit">Criar conta</button>
      </form>
      <a href="/login">Já tenho conta</a>
    </main>
  );
}
