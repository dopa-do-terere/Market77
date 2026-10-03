# Market77: fase 3, agente do totem e comandos remotos

Data: 2026-10-03
Status: aguardando revisão do usuário
Base: `docs/superpowers/specs/2026-10-01-market77-design.md` (seções 3, 6 e 8) e a fase 2, já em `main`.

## 1. Objetivo

O dono vê pelo painel se cada totem está vivo e o reinicia (PDV ou máquina) sem ir à loja. O totem sobe sozinho no boot, abre o PDV em tela cheia e se mantém de pé. O dono também atualiza o próprio agente pelo painel.

Fora desta fase: ponte com leitor de código de barras (o leitor já funciona como teclado no PDV) e com a maquininha (fase 4), alerta por e-mail ou push (o alerta é o selo "offline" no painel), assinatura criptográfica dos pacotes do agente, cartão, NFC-e, lote e validade.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Hardware e rede | Mini PC com Ubuntu, em Wi-Fi, atrás de NAT. O servidor nunca conecta no totem |
| Canal de comandos | Polling. O agente envia heartbeat a cada 30 s e recebe o próximo comando na resposta |
| Comandos | `restart_pdv`, `reboot`, `update` |
| Linguagem do agente | Node e TypeScript, no mesmo repo, em `agent/`, só com a stdlib do Node em produção |
| Navegador | O agente é dono do Chromium em modo kiosk, como processo filho |
| Atualização | Pacote versionado (tarball) guardado no servidor, baixado pelo agente, conferido por SHA-256, com rollback automático |
| Armazenamento do pacote | Interface `ReleaseStore`; a implementação desta fase grava em `bytea` no Postgres, porque o destino provável (Firebase App Hosting, sobre Cloud Run) não tem disco persistente |
| Identidade | O mesmo token de totem da fase 2 (`Authorization: Bearer`), mesmo `requireTerminal` |
| Online ou offline | Calculado na leitura: sem batida há mais de 2 minutos é offline. Não há job para isso |

## 3. Modelo de dados (migration `0004_agent.sql`)

**`terminals`** ganha `last_heartbeat_at timestamptz`, `agent_version text` e `pdv_status text` (`running` ou `stopped`), todos nulos até a primeira batida.

**`terminal_commands`**: `id`, `org_id`, `terminal_id`, `type` (`restart_pdv`, `reboot`, `update`), `payload jsonb` (no `update`: `{ "version": "..." }`), `status` (`pending`, `delivered`, `succeeded`, `failed`), `created_by` (usuário), `created_at`, `delivered_at`, `finished_at`, `error`. FK composta `(org_id, terminal_id)` para `terminals`, como as tabelas da fase 2. RLS por `org_id`, mesma política das outras tabelas de negócio. Permissões da aplicação: `SELECT, INSERT, UPDATE`.

**`agent_releases`**: `version text primary key`, `sha256 text`, `size_bytes int`, `data bytea`, `created_at`. Sem `org_id`: o agente é o mesmo para todos os tenants. A tabela não tem RLS e é acessada só por `adminSql`, atrás da interface `ReleaseStore`; o papel da aplicação não recebe permissão nela. Uma versão publicada nunca muda.

Além da autenticação do totem (já existente), a leitura e a gravação de `agent_releases` usam `adminSql`, pois não há tenant. O restante usa `withOrg`.

## 4. API do agente

Todas autenticadas por `requireTerminal`. Erros e mensagens seguem a tabela da fase 2 (`{ error, message }` em português; 401 `unauthorized` e `terminal_revoked`; entrada validada com zod; JSON quebrado 400; ids malformados 404).

- `POST /api/agent/heartbeat`, corpo `{ agentVersion, pdvStatus }`. Grava `last_heartbeat_at`, `agent_version`, `pdv_status`. Responde `{ command: null | { id, type, version?, sha256? } }`.
  - Entrega no máximo um comando por vez, o mais antigo `pending`, ou um `delivered` sem resultado há mais de 2 minutos (reentrega).
  - Ao entregar, marca `delivered` e `delivered_at`.
  - Um comando `pending` ou `delivered` com mais de 10 minutos de idade vira `failed` com erro `expired` e nunca é entregue. Isso impede que um `reboot` esquecido rode dias depois, quando o totem voltar.
- `POST /api/agent/commands/:id/result`, corpo `{ ok, error? }`. Idempotente: um comando já `succeeded` ou `failed` responde 200 sem mudar nada. Comando de outro totem responde 404.
- `GET /api/agent/releases/:version`: devolve o tarball (`application/gzip`). Versão inexistente responde 404.

Rota interna: `POST /api/internal/releases`, protegida pelo segredo `RELEASE_SECRET` (variável nova no `.env.example`, comparação em tempo constante, como `RECONCILE_SECRET`). Corpo bruto do tarball, versão no cabeçalho `x-version` (formato `1.2.3`), limite de 20 MB. O servidor calcula o SHA-256 e a versão repetida responde 409.

## 5. Painel do dono

Em `/o/[orgId]/terminals` (já existe com lista, cadastro e revogação):
- Colunas novas: estado (online, offline, ou "nunca conectou"), última batida, versão do agente, estado do PDV.
- Botões **Reiniciar PDV**, **Reboot** e **Atualizar**, só para quem tem `terminal:write` (dono). O **Atualizar** envia a versão mais recente de `agent_releases` e fica desabilitado se o totem já está nela ou se não há release. Totem revogado não recebe comando.
- Cada botão cria um `terminal_commands` `pending`, por Server Action. Se o totem já tem um comando do mesmo tipo `pending` ou `delivered`, o novo é recusado (`command_in_progress`), para o dono não empilhar reboots.
- Histórico dos 5 últimos comandos por totem (tipo, quem pediu, estado, erro).
- O alerta de offline é o selo vermelho na lista. A página `/o/[orgId]` mostra também a contagem de totens offline.

Mensagens novas em `src/lib/messages.ts`: `command_in_progress`, `release_not_found`, `release_exists`, `terminal_revoked` (já existe, usada também aqui).

## 6. O agente no mini PC

Código em `agent/`, com `tsconfig` e build próprios, fora do bundle do Next. Lógica separada da entrada e saída: `fetch`, o processo do Chromium e os comandos de sistema são injetados, para teste.

Layout no totem (`/opt/market77/`): `releases/<versão>/` (uma pasta por versão), `current` (symlink para a versão ativa), `config.json` (URL do servidor e token, permissão 600).

Ciclo:
1. Sobe no boot por `systemd` (`User=kiosk`, `Restart=always`), na sessão gráfica X11 com autologin.
2. Abre o Chromium em kiosk em `<servidor>/pdv#token=<token>`. O PDV lê o token do fragmento, guarda em `localStorage` e limpa o fragmento com `history.replaceState`. O fragmento nunca vai ao servidor, e o dono não cola o token à mão. A tela de colar o token continua existindo como alternativa.
3. A cada 30 s envia o heartbeat, com timeout de 10 s.
4. Se o Chromium morrer, reabre com espera crescente entre tentativas.
5. Após 5 falhas seguidas de heartbeat, reinicia o Chromium (spec geral). Nunca reinicia a máquina sozinho. O heartbeat retoma quando a rede voltar.
6. Token revogado (401 `terminal_revoked`): o agente continua tentando em intervalo de 5 minutos e o PDV mostra "Totem desativado".

Comandos:
- `restart_pdv`: mata e reabre o Chromium e responde `ok`.
- `reboot`: responde `ok` primeiro. Só depois de o servidor confirmar o resultado roda `sudo systemctl reboot`. Se não conseguiu confirmar, repete a confirmação e não reinicia. Assim o comando não é reentregue após o boot e não gera laço de reboots. A regra `sudoers` libera só esse comando para o usuário `kiosk`.
- `update`: baixa a versão, confere o SHA-256 recebido no comando, extrai em `releases/<nova>/`, troca o symlink, responde `ok` e encerra o processo. O `systemd` reabre o agente na versão nova. Hash divergente ou erro de extração responde `failed` com o erro e nada muda.

Rollback: o agente novo precisa dar um heartbeat bem-sucedido em até 2 minutos após o update. Um watchdog (unit `systemd` separada, temporizada) volta o symlink à versão anterior e reinicia o agente se isso não acontecer. Mantêm-se as duas últimas versões.

Segurança: o agente fala só com a URL do `config.json`, por HTTPS. Executa apenas os três tipos de comando e nunca passa texto vindo do servidor a um shell. Limite conhecido: o SHA-256 vem do mesmo servidor que serve o pacote, então não protege contra um servidor comprometido. Assinatura do pacote fica como follow-up antes de produção.

Instalação: `agent/install.sh`, executado uma vez como root no mini PC. Instala Node e Chromium, cria o usuário `kiosk` e a regra `sudoers`, grava o `config.json` (pergunta URL e token), instala as units e liga autologin em X11 (Ubuntu usa Wayland por padrão).

Publicar uma versão: `npm run agent:release` empacota `agent/` e envia a `POST /api/internal/releases` com `RELEASE_SECRET`.

## 7. Reconciliação

A rota `/api/internal/reconcile` da fase 2 já existe, protegida por segredo. Esta fase não muda o código dela. Em produção, um agendador externo (Cloud Scheduler no caso do Firebase) a chama a cada minuto. Isso entra como passo de implantação no README, não como código. O cálculo de offline não precisa de agendador.

## 8. Erros e casos de borda

- Totem nunca conectado: estado "nunca conectou", sem última batida.
- Servidor sem resposta: o agente conta falhas, reinicia o Chromium na quinta e segue tentando.
- Heartbeat duplicado ou fora de ordem: só atualiza campos; a entrega do comando é atômica (`update ... where status = 'pending' returning`), então dois heartbeats concorrentes não entregam o mesmo comando duas vezes.
- Resultado de comando enviado duas vezes: idempotente.
- Pacote corrompido ou versão inexistente: o comando `update` falha com erro visível no histórico, sem trocar a versão.
- Update ruim que impede o agente de subir: rollback pelo watchdog.
- Dono tenta comando em totem revogado ou de outro tenant: Server Action recusa; RLS e a FK composta barram o cruzamento.

## 9. Testes

- **Unitário (agente):** ciclo do heartbeat; contagem de 5 falhas e reinício do Chromium; ordem do `reboot` (confirmação antes do comando de sistema, nenhuma execução se a confirmação falha); verificação de SHA-256; rollback; nenhum comando de shell montado com texto do servidor.
- **Domínio e API:** entrega de comando única sob concorrência; reentrega após 2 minutos; expiração após 10 minutos; idempotência do resultado; comando de outro totem 404; estado online e offline por limite de 2 minutos; `command_in_progress`; release repetida 409; limite de tamanho; segredo inválido 401.
- **Isolamento:** RLS em `terminal_commands` (tenant A não lê nem cria comando para totem do B); gerente e repositor sem `terminal:write` (404 na página, recusa na action).
- **Manual, no mini PC (feito pelo dono; o implementador não tem o hardware):** instalar com `install.sh`, boot com autologin e kiosk, desligar o Wi-Fi e ver o PDV "indisponível", reiniciar PDV, reboot, publicar uma versão nova e atualizar, publicar uma versão quebrada e ver o rollback.

## 10. Riscos e premissas

- Autologin em X11 e Chromium em kiosk dependem do Ubuntu e da versão escolhidos; validar no hardware real antes de replicar.
- Sem limite de requisições nas rotas do agente (follow-up junto com o das rotas do PDV).
- A hospedagem final pode ser Firebase App Hosting: o pacote em `bytea` e o limite de 20 MB cabem no limite de requisição de Cloud Run (32 MB). Se o pacote crescer, trocar a implementação do `ReleaseStore` por um storage de objetos.
