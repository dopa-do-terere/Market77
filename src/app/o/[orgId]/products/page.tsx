import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listProducts } from "@/domain/products";
import { message } from "@/lib/messages";
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
    <main>
      <h1>Produtos</h1>
      {error && <p role="alert">{message(error)}</p>}
      <table>
        <thead><tr><th>Nome</th><th>Categoria</th><th>Códigos de barras</th><th>NCM</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.category}</td>
              <td>{p.barcodes.join(", ")}</td>
              <td>
                {p.ncm ?? <strong>sem NCM</strong>}
                {can(role, "product:write") && (
                  <details>
                    <summary>Dados fiscais</summary>
                    <form action={updateProductFiscalAction.bind(null, orgId, p.id)}>
                      <label>NCM <input name="ncm" inputMode="numeric" maxLength={8} defaultValue={p.ncm ?? ""} /></label>
                      <label>CEST <input name="cest" inputMode="numeric" maxLength={7} defaultValue={p.cest ?? ""} /></label>
                      <label>CFOP <input name="cfop" inputMode="numeric" maxLength={4} defaultValue={p.cfop} /></label>
                      <label>CSOSN <input name="csosn" inputMode="numeric" maxLength={3} defaultValue={p.csosn} /></label>
                      <label>Unidade <input name="unit" maxLength={6} defaultValue={p.unit} /></label>
                      <label>Origem (0 a 8) <input name="origin" type="number" min={0} max={8} defaultValue={p.origin} /></label>
                      <button type="submit">Salvar</button>
                    </form>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {can(role, "product:write") && (
        <form action={createProductAction.bind(null, orgId)}>
          <h2>Novo produto</h2>
          <label>Nome <input name="name" required minLength={2} /></label>
          <label>Categoria <input name="category" /></label>
          <label>Códigos de barras (separe por vírgula) <input name="barcodes" /></label>
          <button type="submit">Cadastrar</button>
        </form>
      )}
    </main>
  );
}
