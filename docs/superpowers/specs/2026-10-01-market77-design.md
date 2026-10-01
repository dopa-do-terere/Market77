# Market77: design do sistema

Data: 2026-10-01
Status: aguardando revisão do usuário

## 1. Objetivo

Plataforma SaaS para operação de mercados autônomos, vendida a vários donos de mercado. Um usuário (dono) pode ter vários mercados na mesma conta. O cliente final se atende sozinho em um totem (PDV self-service) dentro da loja.

Contexto inicial de uso: mercados em condomínios fechados, com monitoramento por câmeras. Entrada e saída livres; risco de furto aceito. O produto deve servir a qualquer pessoa/local no futuro.

Critério de sucesso do MVP: um dono cadastra o mercado, produtos e estoque; um cliente anônimo compra no totem pagando por Pix; o estoque baixa automaticamente; o dono acompanha vendas e reinicia o totem remotamente.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Modelo | SaaS multi-tenant; organização com N mercados |
| Cliente final | Anônimo, sem cadastro, sem login |
| Controle de acesso da porta | Fora do MVP. Virá de outro sistema; depois consumimos o log de entrada via webhook |
| PDV | Totem fixo na loja (tela touch + leitor de código de barras), web em modo kiosk |
| Pagamento | Pix e cartão (maquininha integrada). Cada dono usa sua própria conta no provedor; a plataforma não intermedia dinheiro |
| Receita da plataforma | Mensalidade SaaS |
| Estoque | Completo: custo, lote, validade (FEFO) |
| Fiscal | NFC-e via API de terceiros (Focus NFe, eNotas ou PlugNotas); nunca integrar SEFAZ diretamente |
| Conectividade | Totem sempre online; sem venda offline no MVP |
| Totem remoto | Autostart no boot e reinício remoto via agente local |
| Stack | Recomendada: Next.js + TypeScript, Postgres com RLS, Node/NestJS ou rotas Next |

## 3. Arquitetura

```
Painel do dono (Next.js)  --\
Totem PDV (PWA em kiosk)  ---+--> API --> Postgres (org_id/market_id + RLS)
Agente do totem (serviço) --/      |--> Provedor Pix/maquininha (conta do dono)
                                   |--> API fiscal (NFC-e)
                                   '--> Webhook de eventos de acesso (futuro)
```

Unidades e responsabilidades:

- **Painel web:** organização, mercados, produtos, estoque, vendas, totens, credenciais de pagamento e fiscal.
- **PDV (PWA):** escanear, carrinho, pagar. Sem login de cliente.
- **Agente do totem:** serviço no mini PC. Inicia no boot, abre o navegador em kiosk, envia heartbeat, executa comandos remotos (reiniciar PDV, reboot, atualizar) e faz a ponte com leitor de código de barras e maquininha.
- **API:** regras de negócio, multi-tenant, autenticação separada para usuários e totens.
- **Camada de pagamento:** interface única, adaptadores por provedor.
- **Camada fiscal:** interface única, adaptador do provedor de NFC-e.
- **Ponto de extensão de acesso:** endpoint de webhook que grava em `access_events`; sem lógica no MVP.

Tenancy: Organização, com Usuários (papéis: dono, gerente, repositor), com Mercados, com Totens. Toda tabela de negócio leva `org_id` e, quando aplicável, `market_id`, isolada por Row Level Security no Postgres.

## 4. Modelo de dados

Tenancy e dispositivos:
- `organizations`, `users`, `memberships` (user, org, papel)
- `markets` (org_id, nome, endereço, fuso, dados fiscais: CNPJ, IE, regime)
- `terminals` (market_id, token do dispositivo, status, último heartbeat, versão do agente)
- `terminal_commands` (terminal_id, tipo: restart_pdv/reboot/update, status, timestamps)

Catálogo e estoque:
- `products` (org_id, nome, categoria, NCM/CFOP/CEST)
- `product_barcodes` (product_id, código); um produto pode ter vários códigos
- `market_products` (market_id, product_id, preço de venda, estoque mínimo, ativo); preço por mercado
- `stock_lots` (market_product_id, quantidade, custo unitário, validade, recebido_em)
- `stock_movements` (tipo: entrada/venda/perda/ajuste, quantidade, lote, referência); livro-razão, o saldo é a soma dos movimentos e nunca é editado diretamente

Venda e pagamento:
- `sales` (market_id, terminal_id, status: aberta/aguardando_pagamento/paga/cancelada/expirada, total)
- `sale_items` (sale_id, product_id, quantidade, preço unitário, custo no momento da venda)
- `payments` (sale_id, método, provedor, id externo único, status, valor, payload do webhook)
- `fiscal_documents` (sale_id, tipo NFC-e, status, chave, XML/PDF, erro)

Integrações e extensão:
- `provider_credentials` (org ou market, provedor, segredo criptografado)
- `access_events` (market_id, ocorrido_em, payload); vazia no MVP

Regras-chave:
- Estoque só muda via `stock_movements`; a baixa ocorre na confirmação do pagamento, não ao adicionar ao carrinho.
- Baixa por FEFO (vence primeiro, sai primeiro).
- Webhook de pagamento idempotente (id externo único).
- Preço e custo congelados no item da venda.
- Todas as tabelas de negócio com RLS.

## 5. Fluxo de venda

Pix:
1. Cliente escaneia produtos; o PDV busca em `product_barcodes`, cria `sale` aberta e adiciona itens.
2. Cliente escolhe Pix; a API cria a cobrança no provedor do dono; a `sale` vai para aguardando_pagamento; o QR é exibido com expiração (ex.: 3 minutos).
3. O provedor chama o webhook; a API valida a assinatura, registra o `payment` (idempotente), marca a venda como paga, baixa o estoque por FEFO e dispara a emissão fiscal.
4. O PDV recebe a confirmação (polling curto ou SSE), exibe agradecimento e volta à tela inicial.

Cartão: a API solicita a cobrança ao adaptador da maquininha; o agente local faz a ponte com o SDK; o resultado volta à API e segue o passo 3.

## 6. Tratamento de erros

- Pix expirou: venda expira, carrinho preservado, cliente gera novo QR.
- Webhook atrasado ou perdido: job de reconciliação consulta o provedor para vendas em aguardando_pagamento.
- Estoque insuficiente na confirmação: nunca bloquear pagamento confirmado; a venda é sinalizada ao dono e o saldo negativo fica visível.
- NFC-e falhou: a venda segue paga; o documento entra em fila de retry e o erro aparece no painel.
- Totem sem rede: tela de indisponível, sem venda; o agente reinicia o PDV após N falhas de heartbeat.
- Credencial inválida do dono: totem bloqueia pagamento e alerta o dono.
- Carrinho abandonado: venda aberta expira por inatividade e o PDV volta à tela inicial.

Totem remoto: heartbeat a cada 30 s; comandos pendentes são buscados no heartbeat (nenhuma porta de entrada aberta no totem). Offline por mais de 2 minutos gera alerta ao dono.

## 7. Testes

- Unitário: baixa FEFO, saldo por movimentos, idempotência do webhook, máquina de estados da venda.
- Integração: fluxo completo com Pix em sandbox; RLS (tenant A nunca lê dados do tenant B).
- Contrato: adaptadores de pagamento e fiscal contra a mesma suíte.
- Manual: totem real, reboot remoto, queda de rede.

## 8. Fases de entrega

Cada fase terá spec e plano próprios. Ordem:

1. Base SaaS + catálogo e estoque simples
2. PDV + venda + Pix
3. Agente do totem + comandos remotos
4. Maquininha (cartão)
5. Lote/validade completo + NFC-e
6. Integração futura de acesso (log de entrada)

## 9. Fora de escopo no MVP

- Controle de acesso da porta e câmeras
- Venda offline
- Cadastro/login de cliente final, carteira pré-paga
- Intermediação de pagamento (split, subadquirência)
- App nativo

## 10. Premissas a validar

- Maquininha: modelo e SDK ainda não definidos; define o esforço da fase 4.
- Provedor Pix e provedor fiscal: escolha final pendente.
- Exigência de nota fiscal pelos condomínios pode antecipar a fase 5.
