import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Logo,
  PageHeader,
  Select,
  Table,
  type Tone,
} from "@/ui";

const tones: Tone[] = ["neutral", "success", "warning", "danger", "brand"];

export default function UiReferencePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <Logo className="h-10 w-auto" />
      <a href="/ui/dashboard" className="text-sm font-semibold text-link hover:underline">Abrir prévia do painel →</a>
      <PageHeader title="Componentes" description="Referência visual. Só existe fora de produção." actions={<Button>Ação</Button>} />
      <Card title="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button disabled>Desativado</Button>
          <Button size="touch">Toque</Button>
        </div>
      </Card>
      <Card title="Campos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome"><Input placeholder="Nome" /></Field>
          <Field label="Com erro"><Input invalid defaultValue="valor" /></Field>
          <Field label="Seleção"><Select><option>Um</option><option>Dois</option></Select></Field>
          <Checkbox label="Ativo" defaultChecked />
        </div>
      </Card>
      <Card title="Badges">
        <div className="flex flex-wrap gap-2">
          {tones.map((t) => (
            <Badge key={t} tone={t}>{t}</Badge>
          ))}
        </div>
      </Card>
      <div className="space-y-3">
        <Alert tone="info">Informação</Alert>
        <Alert tone="success">Sucesso</Alert>
        <Alert tone="warning">Aviso</Alert>
        <Alert tone="danger">Erro</Alert>
      </div>
      <Table>
        <thead>
          <tr><th>Produto</th><th>Preço</th><th>Situação</th></tr>
        </thead>
        <tbody>
          <tr><td>Água 500 ml</td><td>R$ 3,50</td><td><Badge tone="success">Ativo</Badge></td></tr>
          <tr><td>Biscoito</td><td>R$ 5,90</td><td><Badge tone="warning">Estoque baixo</Badge></td></tr>
        </tbody>
      </Table>
    </main>
  );
}
