import { notFound } from "next/navigation";
import { PdvWelcome } from "@/app/pdv/PdvApp";

export default function PdvPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <div className="flex flex-wrap justify-between gap-3 border-b border-border bg-surface px-6 py-4 text-sm text-muted">
        <span>Prévia visual do autoatendimento · Apenas em desenvolvimento</span>
        <a href="/ui/dashboard" className="font-medium text-link hover:underline">Voltar ao painel</a>
      </div>
      <PdvWelcome />
    </>
  );
}
