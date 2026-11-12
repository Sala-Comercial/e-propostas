# Ver o banco do criador no TablePlus

O TablePlus está em **Aplicativos**. O banco é o Postgres.app deste Mac.

## Conectar (uma vez)

1. Abra o **TablePlus** → **Create a new connection…** → **PostgreSQL** → **Create**.
2. Preencha:
   - **Name:** Criador de propostas
   - **Host:** `127.0.0.1` · **Port:** `5432`
   - **User:** o seu usuário do Mac (`leouroso`) · **Password:** em branco
   - **Database:** `criador`
3. **Test** (fica verde) → **Connect**.

Atalho: em vez de preencher, use **Import from URL** e cole
`postgresql://leouroso@127.0.0.1:5432/criador`.
No Terminal, `npm run banco` mostra essa URL e quantas linhas tem cada tabela.

## O que olhar

As tabelas aparecem na barra da esquerda (schema `public`):

- **chat_conversa** — cada proposta. A coluna `estado` (JSON) tem cliente,
  canal e os três planos; clique na célula para ver formatado.
- **chat_versao** — as versões enviadas ao gerente (`is_current` marca a atual).
- **chat_mensagem** / **chat_anexo** — a conversa e os arquivos.
- **catalogo_item** — os preços. Dá para mudar um preço aqui (e **⌘S** para
  salvar): o criador usa na hora. Prefira mudar por Configurações › Itens,
  que deixa registrado quem mudou.
- **audit_log** — o histórico: quem fez, o quê, antes → depois. Não aceita
  edição nem exclusão (o banco recusa).
- **sessao_log** — entradas, saídas e senhas erradas.
- **usuario** — a coluna `senha_hash` é o resumo da senha, nunca a senha.

As datas estão em **UTC**: Brasília é UTC−3 e Manaus é UTC−4 (ex.: 14:00 no banco = 10:00 em Manaus).

## Cuidados

- Não apague linhas à mão: use a Lixeira do criador (fica registrado e dá
  para voltar).
- Testes nunca no banco `criador`: ele é o de verdade.
