import type { ReactNode } from "react";
import { Card } from "./Card";
import { Logo } from "./Logo";
import { Icon } from "./Icon";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="auth-story relative hidden flex-col justify-between overflow-hidden border-r border-border p-12 lg:flex xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute -right-64 -bottom-48 size-[640px] rounded-full border-[70px] border-white/15" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-20 size-64 rounded-full border-[40px] border-white/20" />
        <div className="relative"><Logo className="h-10 w-auto" /><p className="mt-4 text-sm text-muted">Gestão de mercados autônomos</p></div>
        <div className="relative max-w-lg py-16">
          <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200">Mais clareza para sua operação</span>
          <h2 className="mt-6 text-5xl leading-[1.12] font-semibold tracking-tight xl:text-6xl">Seu mercado.<br /><span className="text-[#88400c] dark:text-brand-200">Tudo conectado.</span></h2>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-muted">Da reposição ao pagamento, acompanhe cada etapa em um só lugar.</p>
          <div className="mt-10 space-y-4">
            {[["product", "Estoque e validade sob controle"], ["sales", "Vendas e pagamentos centralizados"], ["terminal", "Autoatendimento conectado à gestão"]].map(([icon, label]) => <div key={icon} className="flex items-center gap-3 text-sm font-medium"><span className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-link"><Icon name={icon as "product" | "sales" | "terminal"} /></span>{label}</div>)}
          </div>
        </div>
        <p className="relative text-xs text-muted">Market77 · Sua operação, conectada.</p>
      </section>
      <div className="flex flex-col items-center justify-center gap-8 px-4 py-12 sm:px-10">
        <div className="lg:hidden"><Logo className="h-9 w-auto" /></div>
        <Card className="w-full max-w-md sm:[&>div]:p-8">
          <p className="mb-2 text-xs font-semibold tracking-widest text-link uppercase">Bem-vindo ao Market77</p>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 mb-7 text-sm leading-relaxed text-muted">{title === "Entrar" ? "Acesse sua conta para acompanhar seus mercados." : "Crie seu espaço para começar a gerenciar seus mercados."}</p>
          {children}
        </Card>
        <p className="text-xs text-muted">Plataforma para mercados autônomos</p>
      </div>
    </main>
  );
}
