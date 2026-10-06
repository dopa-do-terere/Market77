import { notFound } from "next/navigation";
import { Badge, Button, ButtonLink, Card, Field, Icon, Input, PageHeader, StatCard, Table, type IconName } from "@/ui";

type Screen = { title: string; description: string; icon: IconName; columns: string[]; rows: string[][]; form?: { title: string; fields: string[] } };
const screens: Record<string, Screen> = {
  products: { title: "Produtos", description: "Seu catálogo centralizado, com códigos de barras e dados fiscais.", icon: "product", columns: ["Produto", "Categoria", "Código de barras", "NCM"], rows: [["Água mineral 500 ml", "Bebidas", "7891000100103", "22011000"], ["Café gelado 250 ml", "Bebidas", "7891000100104", "Sem NCM"], ["Biscoito integral", "Mercearia", "7891000100105", "19053100"]], form: { title: "Novo produto", fields: ["Nome", "Categoria", "Códigos de barras"] } },
  sales: { title: "Vendas", description: "Acompanhe os pedidos, os pagamentos e as pendências fiscais.", icon: "sales", columns: ["Data", "Mercado", "Itens", "Total", "Situação"], rows: [["06/10/2026, 14:32", "Residencial Aurora", "3", "R$ 28,90", "Paga"], ["06/10/2026, 14:20", "Condomínio Jardins", "2", "R$ 16,40", "Aguardando pagamento"]] },
  terminals: { title: "Totens", description: "Acompanhe a conexão dos equipamentos e gerencie o autoatendimento.", icon: "terminal", columns: ["Nome", "Mercado", "Estado", "Agente", "PDV"], rows: [["Totem da entrada", "Residencial Aurora", "Online", "1.0.0", "Aberto"], ["Totem principal", "Condomínio Jardins", "Offline", "1.0.0", "Parado"]], form: { title: "Novo totem", fields: ["Nome do totem", "Mercado", "ID da maquininha Point"] } },
  team: { title: "Equipe", description: "Compartilhe a operação com quem cuida dos seus mercados.", icon: "team", columns: [], rows: [], form: { title: "Adicionar membro", fields: ["E-mail", "Senha inicial", "Papel"] } },
  "settings/payments": { title: "Pagamentos", description: "Conecte sua conta Mercado Pago para receber por Pix e cartão.", icon: "payment", columns: [], rows: [], form: { title: "Conexão com Mercado Pago", fields: ["Access token", "Segredo do webhook"] } },
  stock: { title: "Residencial Aurora", description: "Produtos, reposição e validade da sua unidade.", icon: "market", columns: ["Produto", "Preço", "Mínimo", "Saldo", "Ativo", "Validade"], rows: [["Água mineral 500 ml", "R$ 3,50", "5", "23", "Sim", "Não controla"], ["Café gelado 250 ml", "R$ 12,90", "3", "0 · Baixo", "Sim", "Controla"]], form: { title: "Produtos deste mercado", fields: ["Produto", "Preço (R$)", "Estoque mínimo"] } },
  access: { title: "Acessos", description: "Entradas e leitores de Residencial Aurora.", icon: "team", columns: ["Dia", "Entradas", "Pessoas", "Vendas pagas"], rows: [["06/10/2026", "24", "17", "12"], ["05/10/2026", "31", "23", "19"]], form: { title: "Leitores", fields: ["Nome do leitor"] } },
};

export default async function ScreenPreview({ params }: { params: Promise<{ section: string[] }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { section } = await params;
  const key = section.join("/");
  if (section[0] === "sales" && section.length === 2) {
    const index = ["exemplo-1", "exemplo-2"].indexOf(section[1]);
    if (index < 0) notFound();
    const row = screens.sales.rows[index];
    const paid = index === 0;
    return (
      <main className="space-y-6">
        <PageHeader icon="sales" title="Detalhes da venda" description={`${row[1]} · ${row[0]}`} actions={<ButtonLink href="/ui/dashboard/sales" variant="secondary"><Icon name="back" /> Vendas</ButtonLink>} />
        <Card className="metric-featured"><p className="text-sm text-muted">Total da compra</p><p className="mt-2 text-3xl font-semibold">{row[3]}</p></Card>
        <Card icon="product" title="Itens da compra">
          <ul className="divide-y divide-border text-sm">
            {[["Água mineral 500 ml", "R$ 3,50"], ["Café gelado 250 ml", "R$ 12,90"], ...(paid ? [["Sanduíche natural", "R$ 12,50"]] : [])].map(([name, price]) => <li key={name} className="flex flex-wrap justify-between gap-3 py-3"><span className="font-medium">1 × {name}</span><span className="text-muted">{price} por unidade</span></li>)}
          </ul>
        </Card>
        <Card icon="payment" title="Pagamentos"><div className="flex flex-wrap items-center gap-3 text-sm"><span>Pix</span><Badge tone={paid ? "success" : "warning"}>{paid ? "Confirmado" : "Pendente"}</Badge><span className="text-muted">Valor esperado: {row[3]}</span></div></Card>
      </main>
    );
  }
  if (key === "markets") return (
    <main className="space-y-6">
      <PageHeader icon="market" title="Mercados" description="Gerencie suas unidades e acompanhe a operação de cada mercado." />
      <div className="grid gap-5 lg:grid-cols-2">
        {[{ id: "aurora", name: "Residencial Aurora", address: "Rua das Palmeiras, 120" }, { id: "jardins", name: "Condomínio Jardins", address: "Av. Central, 850" }, { id: "parque", name: "Parque das Flores", address: "Rua dos Ipês, 42" }].map((market) => (
          <Card key={market.id} icon="market" title={market.name} description={market.address}>
            <a href={`/ui/dashboard/markets/${market.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-link">Gerenciar mercado <Icon name="arrow" className="size-4" /></a>
          </Card>
        ))}
      </div>
      <PreviewForm title="Novo mercado" fields={["Nome", "Endereço", "CNPJ"]} />
    </main>
  );
  const stock = section[0] === "markets" && section.length === 2;
  const access = section[0] === "markets" && section.length === 3 && section[2] === "access";
  const screenKey = stock ? "stock" : access ? "access" : key;
  const screen = Object.hasOwn(screens, screenKey) ? screens[screenKey] : undefined;
  const names: Record<string, string> = { aurora: "Residencial Aurora", jardins: "Condomínio Jardins", parque: "Parque das Flores" };
  const marketName = Object.hasOwn(names, section[1]) ? names[section[1]] : undefined;
  if (!screen || ((stock || access) && !marketName)) notFound();
  const title = stock ? marketName : screen.title;
  const metrics = key === "products" ? [
    { label: "Produtos no catálogo", value: screen.rows.length, icon: "product" as const },
    { label: "Categorias", value: new Set(screen.rows.map((r) => r[1])).size, icon: "dashboard" as const },
    { label: "Sem NCM", value: screen.rows.filter((r) => r[3] === "Sem NCM").length, icon: "sales" as const },
  ] : key === "terminals" ? [
    { label: "Totens ativos", value: screen.rows.length, icon: "terminal" as const },
    { label: "Online", value: screen.rows.filter((r) => r[2] === "Online").length, icon: "check" as const },
    { label: "Sem comunicação", value: screen.rows.filter((r) => r[2] === "Offline").length, icon: "warning" as const },
  ] : [
    { label: "Registros de exemplo", value: screen.rows.length, icon: screen.icon },
  ];
  return (
    <main className="space-y-6">
      <PageHeader icon={screen.icon} title={title} description={access ? `Entradas e leitores de ${marketName}.` : screen.description} actions={stock || access ? <>
        <ButtonLink href={stock ? "/ui/dashboard/markets" : `/ui/dashboard/markets/${section[1]}`} variant="secondary"><Icon name="back" /> {stock ? "Mercados" : "Voltar ao mercado"}</ButtonLink>
        {stock && <ButtonLink href={`/ui/dashboard/${key}/access`} variant="secondary"><Icon name="team" /> Acessos</ButtonLink>}
      </> : undefined} />
      {screen.rows.length > 0 && <div className="grid gap-4 sm:grid-cols-3">
        {metrics.map((metric, index) => <StatCard key={metric.label} {...metric} note="Dados ilustrativos para revisão do design" featured={index === 0} />)}
      </div>}
      {key === "team" && <div className="grid gap-4 sm:grid-cols-2"><Card icon="team" title="Gerente"><p className="text-sm text-muted">Gerencia produtos, preços e estoque e acompanha as vendas.</p></Card><Card icon="product" title="Repositor"><p className="text-sm text-muted">Consulta produtos e registra as movimentações de estoque.</p></Card></div>}
      {key === "settings/payments" && <Card icon="payment" title="Status da conexão"><Badge tone="neutral">Não conectado · Exemplo</Badge></Card>}
      {screen.columns.length > 0 && <Table title={screen.title} description="Exemplo visual dos registros desta seção.">
        <thead><tr>{screen.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{screen.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{key === "sales" && cell === 0 ? <a href={`/ui/dashboard/sales/exemplo-${index + 1}`} className="font-medium text-link hover:underline">{value}</a> : ["Paga", "Online"].includes(value) ? <Badge tone="success">{value}</Badge> : ["Offline", "Sem NCM", "Aguardando pagamento"].includes(value) ? <Badge tone="warning">{value}</Badge> : value}</td>)}</tr>)}</tbody>
      </Table>}
      {screen.form && <PreviewForm {...screen.form} />}
    </main>
  );
}

function PreviewForm({ title, fields }: { title: string; fields: string[] }) {
  return <Card icon="plus" title={title} description="Prévia dos campos. Os cadastros estão disponíveis no painel autenticado.">
    <fieldset disabled className="grid gap-4 sm:grid-cols-3">
      {fields.map((label) => <Field key={label} label={label}><Input placeholder={label} /></Field>)}
      <div className="sm:col-span-3"><Button disabled>Salvar</Button></div>
    </fieldset>
  </Card>;
}
