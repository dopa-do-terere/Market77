import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listProducts } from "@/domain/products";
import { message } from "@/lib/messages";
import { createProductAction } from "./actions";

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
        <thead><tr><th>Nome</th><th>Categoria</th><th>Códigos de barras</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.category}</td><td>{p.barcodes.join(", ")}</td></tr>
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
