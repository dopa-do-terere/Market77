import { message } from "@/lib/messages";
import { loginAction } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Entrar</h1>
      {error && <p role="alert">{message(error)}</p>}
      <form action={loginAction}>
        <label>E-mail <input name="email" type="email" required /></label>
        <label>Senha <input name="password" type="password" required /></label>
        <button type="submit">Entrar</button>
      </form>
      <a href="/signup">Criar conta</a>
    </main>
  );
}
