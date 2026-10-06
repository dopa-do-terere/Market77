import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listProducts } from "@/domain/products";
import { message } from "@/lib/messages";
import { Alert, Badge, Button, Card, EmptyState, Icon, StatCard, Field, Input, PageHeader, Table } from "@/ui";
import { createProductAction, updateProductFiscalAction } from "./actions";

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId } = await params;
  const { error } = await searchParams;
  const { role } = await requireOrgPage(orgId, "catalog:read");
  const products = await withOrg(orgId, (tx) => listProducts(tx));
  return (
    <main className="space-y-6">
      <PageHeader icon="product" title="Produtos" description="Seu catálogo centralizado, com códigos de barras e dados fiscais." />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Produtos no catálogo" value={products.length} note="Cadastro compartilhado entre seus mercados" icon="product" featured />
        <StatCard label="Categorias" value={new Set(products.map((p) => p.category).filter(Boolean)).size} note="Organização do seu catálogo" icon="dashboard" />
        <StatCard label="Sem NCM" value={products.filter((p) => !p.ncm).length} note="Produtos com cadastro fiscal pendente" icon="sales" />
      </div>
      <Table title="Catálogo de produtos" description="Consulte os códigos de barras e complete os dados fiscais.">
        <thead>
          <tr><th>Nome</th><th>Categoria</th><th>Códigos de barras</th><th>NCM</th></tr>
        </thead>
        <tbody>
          {products.length === 0 && <tr><td colSpan={4}><EmptyState icon="product" title="Seu catálogo começa aqui" description="Cadastre os primeiros produtos para disponibilizá-los nos seus mercados." /></td></tr>}
          {products.map((p) => (
            <tr key={p.id}>
              <td><span className="flex items-center gap-3 font-medium"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-link"><Icon name="product" className="size-4" /></span>{p.name}</span></td>
              <td>{p.category || "Sem categoria"}</td>
              <td className="break-all">{p.barcodes.join(", ")}</td>
              <td>
                {p.ncm ?? <Badge tone="warning">sem NCM</Badge>}
                {can(role, "product:write") && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-link">Dados fiscais</summary>
                    <form action={updateProductFiscalAction.bind(null, orgId, p.id)} className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="NCM"><Input name="ncm" inputMode="numeric" maxLength={8} defaultValue={p.ncm ?? ""} /></Field>
                      <Field label="CEST"><Input name="cest" inputMode="numeric" maxLength={7} defaultValue={p.cest ?? ""} /></Field>
                      <Field label="CFOP"><Input name="cfop" inputMode="numeric" maxLength={4} defaultValue={p.cfop} /></Field>
                      <Field label="CSOSN"><Input name="csosn" inputMode="numeric" maxLength={3} defaultValue={p.csosn} /></Field>
                      <Field label="Unidade"><Input name="unit" maxLength={6} defaultValue={p.unit} /></Field>
                      <Field label="Origem (0 a 8)"><Input name="origin" type="number" min={0} max={8} defaultValue={p.origin} /></Field>
                      <div className="sm:col-span-3">
                        <Button type="submit">Salvar</Button>
                      </div>
                    </form>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {can(role, "product:write") && (
        <Card icon="plus" title="Novo produto" description="Adicione um item ao catálogo da organização.">
          <form action={createProductAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome"><Input name="name" required minLength={2} /></Field>
            <Field label="Categoria"><Input name="category" /></Field>
            <Field label="Códigos de barras (separe por vírgula)"><Input name="barcodes" /></Field>
            <div className="sm:col-span-3">
              <Button type="submit">Cadastrar</Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
}
