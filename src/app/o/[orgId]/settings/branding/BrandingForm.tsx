"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { Branding } from "@/domain/branding";
import { Alert, Button, Card, Checkbox, Field, Input } from "@/ui";
import { MarketBrand, PoweredBy } from "@/ui/MarketBrand";
import { saveBrandingAction } from "./actions";

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending}>{pending ? "Salvando…" : "Salvar minha marca"}</Button>;
}

export function BrandingForm({ orgId, brand }: { orgId: string; brand: Branding | null }) {
  const [name, setName] = useState(brand?.name ?? "");
  const [logo, setLogo] = useState<string | null>(brand?.logoDataUrl ?? null);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  return <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
    <Card icon="market" title="Identidade do mercado" description="Esta marca aparece em todos os mercados da sua organização.">
      <form action={saveBrandingAction.bind(null, orgId)} className="space-y-5">
        <Field label="Nome da marca"><Input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} placeholder="Ex.: Mercado Aurora" /></Field>
        <Field label="Logo do mercado"><input type="file" name="logo" accept="image/png,image/jpeg,image/webp" aria-describedby="logo-help" className="block w-full rounded-xl border border-border p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-subtle file:px-3 file:py-2 file:text-fg" onChange={(e) => {
          const file = e.target.files?.[0];
          setError("");
          if (!file) { setLogo(brand?.logoDataUrl ?? null); return; }
          if (file.size > 512 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            e.target.value = ""; setLogo(brand?.logoDataUrl ?? null); setError("Escolha uma imagem PNG, JPG ou WebP de até 512 KB."); return;
          }
          setReading(true);
          const reader = new FileReader();
          reader.onload = () => { setLogo(reader.result as string); setRemove(false); setReading(false); };
          reader.onerror = () => { setError("Não foi possível ler a imagem. Selecione o arquivo novamente."); setReading(false); };
          reader.readAsDataURL(file);
        }} /></Field>
        <p id="logo-help" className="text-sm leading-relaxed text-muted">PNG, JPG ou WebP de até 512 KB. Prefira fundo transparente e uma imagem com boa resolução. Sua logo será exibida inteira, sem cortes.</p>
        {brand?.logoDataUrl && <Checkbox name="removeLogo" label="Remover a logo atual" checked={remove} onChange={(e) => setRemove(e.target.checked)} />}
        {error && <Alert tone="danger">{error}</Alert>}
        <SaveButton disabled={!!error || reading} />
      </form>
    </Card>
    <Card title="Veja como fica" description="Sua marca em destaque; a nossa assina a tecnologia.">
      <div className="rounded-2xl border border-border bg-subtle p-8"><MarketBrand brand={{name: name.trim() || "Seu mercado", logoDataUrl: remove ? null : logo}} /><p className="mt-6 text-center text-sm text-muted">Bem-vindo ao seu mercado</p><div className="mt-8 border-t border-border pt-5"><PoweredBy /></div></div>
    </Card>
  </div>;
}
