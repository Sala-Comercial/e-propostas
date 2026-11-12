# Criador de propostas com chat (SASI)

Projeto separado do E- Propostas, por enquanto. O vendedor monta a proposta
conversando com o assistente (GPT), que busca o negócio no HubSpot, a
população no IBGE e os preços no catálogo de itens. A proposta leva os três
planos (Básico, Pro e Premium); o vendedor aprova, o PDF é gerado e vai para o
gerente aprovar.

- Login com e-mail e senha (sem cadastro aberto: o gerente cadastra as pessoas).
- A chave do GPT e o token do HubSpot ficam **só** no arquivo `.env`, neste
  computador. O navegador nunca vê os dois.
- Tudo fica num banco **Postgres** (`DATABASE_URL` no `.env`): usuários,
  propostas, versões, mensagens, anexos, avisos, catálogo e o histórico de quem
  fez o quê. Hoje é o Postgres.app deste Mac; pode ir para o Supabase (local
  ou na nuvem) trocando só a URL — veja "Banco de dados" no fim.

## Passo a passo

### 1. Pegar a chave do GPT (OpenAI)

1. Entre em <https://platform.openai.com/api-keys> com a conta da SASI.
2. Clique em **Create new secret key**, dê o nome `criador-propostas` e crie.
3. Copie a chave (começa com `sk-`). Ela só aparece uma vez.
4. Em <https://platform.openai.com/settings/organization/billing> confira se há
   crédito ou cartão. Sem isso a chave não funciona.

### 2. Pegar o token do HubSpot

1. No HubSpot, vá em **Configurações** (engrenagem) › **Integrações** ›
   **Apps privados** (em contas novas: **Desenvolvimento** › **Apps legados** ›
   **Criar app privado**).
2. Clique em **Criar um app privado** e dê o nome `Criador de propostas`.
3. Na aba **Escopos**, marque:
   - `crm.objects.deals.read`
   - `crm.objects.deals.write`
   - `crm.objects.owners.read`
4. Clique em **Criar app** e copie o **token de acesso** (começa com `pat-`).

> Quem cria o app privado precisa ser super admin no HubSpot.

### 3. Colocar a chave e o token no `.env`

No Terminal:

```bash
cd ~/criador-propostas-chat
cp .env.example .env
open -e .env
```

O `.env` abre no TextEdit. Cole depois do `=`, sem espaços nem aspas:

```
OPENAI_API_KEY=sk-...
HUBSPOT_TOKEN=pat-...
```

Salve (⌘S) e feche. **Não mande a chave nem o token por chat, e-mail ou
WhatsApp.**

### 4. Ligar o banco (Postgres.app)

1. Abra o **Postgres.app** (em Aplicativos) e clique em **Initialize** (só na
   primeira vez). Ele passa a ligar sozinho com o Mac.
2. No Terminal, crie o banco do criador:

```bash
/Applications/Postgres.app/Contents/Versions/latest/bin/createdb criador
```

3. No `.env`, a linha do banco (troque `SEU_USUARIO` pelo usuário do Mac):

```
DATABASE_URL=postgres://SEU_USUARIO@127.0.0.1:5432/criador
```

As tabelas nascem sozinhas na primeira vez que o criador liga. Para ver os
dados por dentro, use o TablePlus: passo a passo em `docs/tableplus.md`.

### 5. Criar o seu usuário

```bash
cd ~/criador-propostas-chat
npm run criar-usuario
```

Responda nome, e-mail, papel (`gerente`) e a senha (não aparece enquanto
digita). Depois, pela tela, em **Configurações › Usuários**, você cadastra os
vendedores.

### 6. Ligar

```bash
cd ~/criador-propostas-chat
npm start
```

Abra <http://localhost:8790> e entre. O Terminal mostra se o GPT e o HubSpot
estão ligados. Para desligar: `Ctrl + C` no Terminal.

## Regras que o sistema segue

- O vendedor só vê os próprios negócios do HubSpot e as próprias propostas
  (regra ética). Se o negócio não existe, o chat cria no HubSpot com ele como dono.
- Canal por usuários: app interno 100; para a população, até 5.000 hab. → 1.000;
  até 20.000 → 5.000; até 100.000 → 10.000; acima → 20.000. O vendedor pode
  trocar, com motivo, que o gerente vê.
- Cobrança: implementação (única, no 1º mês) + licença mensal + suporte mensal.
- Item sem preço no catálogo trava o envio: o gerente preenche em
  **Configurações › Itens**.
- O que entra em cada plano ainda é um exemplo (Básico: canal, monitoramento e
  suporte; Pro: + IA e WhatsApp; Premium: + B.I. e ícone nas lojas).

## PRD e Novidades

As abas **PRD** e **Novidades** de Configurações leem os arquivos da pasta `docs/`:

- `docs/prd.html`: cópia do PRD publicado (o botão "Abrir versão completa" leva ao original). Quando o PRD mudar, a cópia precisa ser atualizada.
- `docs/novidades.json`: o que mudou, do mais novo para o mais antigo. Uma entrada nova acende um ponto verde na aba para quem ainda não viu.

## Banco de dados

Estrutura (em `db/migrations/`), seguindo as regras das reuniões e o mesmo
padrão do Controle de Adesões e do E- Propostas:

| Tabela | O que guarda |
|---|---|
| `usuario` | pessoas, papel (vendedor ou gerente), hash da senha |
| `sessao` | logins abertos (só o hash do token) |
| `usuario_visualizacao` | preferências de tela de cada pessoa (largura do painel etc.) |
| `catalogo_item` | itens e preços (Configurações › Itens) |
| `chat_conversa` | a proposta: estado, planos, situação |
| `chat_versao` | foto de cada versão enviada ou decidida |
| `chat_mensagem` / `chat_anexo` | a conversa e os arquivos (dentro do banco) |
| `notificacao` | avisos do sino |
| `modalidade_contratacao` | textos jurídicos da página 3 da proposta, com a validação do Jurídico |
| `audit_log` | histórico de tudo o que mudou (antes → depois); **não pode ser alterado nem apagado** |
| `sessao_log` | entradas, saídas e senhas erradas; também imutável |
| `migracao` | quais migrações já rodaram |

- **Lixeira:** conversa apagada fica 30 dias em Configurações › Lixeira e volta
  inteira. Depois disso, a limpeza diária apaga de vez (e registra no histórico).
- **Comandos:** `npm run banco` (onde está e quantas linhas tem cada tabela),
  `npm run migrar` (aplica as migrações), `npm run importar-json` (traz os
  dados da versão antiga, da pasta `data/`; pode rodar de novo sem duplicar).

### Mudar o banco de lugar

O código é o mesmo em qualquer Postgres. Para mudar:

1. **Supabase local:** instale o Docker Desktop e o Supabase CLI, rode
   `supabase start` e use
   `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
2. **Supabase na nuvem:** crie o projeto (região São Paulo), copie a
   connection string **Session pooler** em *Connect* e ponha a senha do banco.
   Baixe o certificado (*Database Settings › SSL*) e aponte
   `DATABASE_CA_FILE` para ele. Lembre que os dados de clientes passam a ficar
   fora deste computador (LGPD).
3. Em qualquer destino: `npm run migrar` e depois copie os dados do banco
   atual com `pg_dump --data-only` → `psql` (ou só comece do zero).

No Supabase, as tabelas ficam com RLS ligado e sem regras: a API pública dele
(chave anon) não lê nem grava nada; só o criador, que conecta como dono.

## Modelo da proposta

O PDF que vai ao cliente tem 3 páginas (modelo da proposta de Aliança, sem o
que é específico do Cidade na Mão):

1. **Capa:** nome da solução, faixa com o slogan, celular com o cliente e os
   serviços (provisório) e o rodapé oficial (`public/img/rodape-sasi.png`).
2. **Tabela de preços:** os três planos, a tabela completa item × plano,
   economia dos itens sem custo e o cronograma de implementação.
3. **Modalidade de contratação:** só para cliente público com modalidade
   escolhida no chat. Os textos ficam em Configurações › Modalidades e só valem
   depois de validados pelo Jurídico.
