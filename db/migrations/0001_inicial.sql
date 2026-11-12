-- 0001_inicial — tabelas do Criador de propostas com chat.
--
-- Estrutura conforme as regras de banco das reuniões (backlog de 08/09/2026),
-- com os mesmos nomes do Controle de Adesões para as tabelas transversais
-- (audit_log, sessao_log, usuario_visualizacao) e do E- Propostas para as do
-- chat (chat_conversa, chat_mensagem, chat_anexo, catalogo_item).
--
-- Postgres puro: roda no Postgres.app, no Supabase (local ou nuvem) ou em
-- qualquer Postgres 14+. Datas em UTC: TIMESTAMP(3) sem fuso, gravado como
-- (now() AT TIME ZONE 'UTC'), seja qual for o fuso do servidor.
-- Idempotente: reaplicar não apaga nem duplica nada.

/* ═══ pessoas e acesso ═══ */

CREATE TABLE IF NOT EXISTS usuario (
  id             TEXT PRIMARY KEY,
  nome           TEXT NOT NULL,
  email          TEXT NOT NULL,
  -- scrypt com sal ("sal:hash"); a senha nunca é guardada
  senha_hash     TEXT NOT NULL,
  -- vendedor | gerente
  papel          TEXT NOT NULL DEFAULT 'vendedor',
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  atualizado_em  TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  -- lixeira: não é purgado (a autoria no audit_log depende dele)
  deleted_at     TIMESTAMP(3),
  deleted_by     TEXT
);
-- e-mail único só entre os vivos: quem está na lixeira não ocupa o endereço
CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_vivo_key ON usuario (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS usuario_deleted_at_idx ON usuario (deleted_at);

-- Sessão de login: guarda só o hash (SHA-256) do token do cookie.
CREATE TABLE IF NOT EXISTS sessao (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  expira_em   TIMESTAMP(3) NOT NULL,
  criado_em   TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS sessao_usuario_idx ON sessao (usuario_id);
CREATE INDEX IF NOT EXISTS sessao_expira_idx ON sessao (expira_em);

-- Visualizações e preferências de tela, por usuário (no banco, não no
-- navegador: seguem a pessoa em qualquer computador).
CREATE TABLE IF NOT EXISTS usuario_visualizacao (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  -- qual tela (hoje: "chat")
  tela        TEXT NOT NULL,
  nome        TEXT NOT NULL DEFAULT 'padrão',
  -- largura do painel, barra lateral recolhida, novidades vistas…
  config      JSONB NOT NULL DEFAULT '{}',
  is_default  BOOLEAN NOT NULL DEFAULT TRUE,
  -- PESSOAL (só do dono) | COMPARTILHADA (publicada pelo gerente)
  escopo      TEXT NOT NULL DEFAULT 'PESSOAL',
  criado_em   TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  criado_por  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS usuario_visualizacao_usuario_tela_idx ON usuario_visualizacao (usuario_id, tela);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_visualizacao_padrao_key ON usuario_visualizacao (usuario_id, tela) WHERE is_default;

/* ═══ catálogo ═══ */

-- Catálogo de itens (Configurações › Itens). Cada item é cobrado em um dos três
-- componentes: implementação (única, no 1º mês), licença mensal ou suporte
-- mensal. Preço nulo = ainda sem preço: a proposta não sai com ele num plano.
-- Os valores iniciais entram pela aplicação, só quando a tabela está vazia.
CREATE TABLE IF NOT EXISTS catalogo_item (
  id                 TEXT PRIMARY KEY,
  grupo              TEXT NOT NULL,
  nome               TEXT NOT NULL,
  -- implementacao | licenca | suporte
  componente         TEXT NOT NULL,
  preco              NUMERIC(14,2),
  unidade            TEXT NOT NULL DEFAULT 'mês',
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  ordem              INTEGER NOT NULL DEFAULT 0,
  atualizado_por_id  TEXT REFERENCES usuario(id) ON DELETE SET NULL,
  atualizado_em      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  deleted_at         TIMESTAMP(3),
  deleted_by         TEXT
);
CREATE INDEX IF NOT EXISTS catalogo_item_deleted_at_idx ON catalogo_item (deleted_at);

/* ═══ chat: conversa = proposta ═══ */

-- O estado (cliente, faixa, planos, itens) fica em "estado". As versões
-- enviadas ficam em chat_versao; "registro" é o quem-fez-o-quê mostrado na tela
-- (a trilha formal é o audit_log).
CREATE TABLE IF NOT EXISTS chat_conversa (
  id             TEXT PRIMARY KEY,
  dono_id        TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL DEFAULT 'Nova conversa',
  -- rascunho | revisao | ajustar | aprovada
  status         TEXT NOT NULL DEFAULT 'rascunho',
  estado         JSONB NOT NULL DEFAULT '{}',
  registro       JSONB NOT NULL DEFAULT '[]',
  -- o gerente mexeu na versão em revisão: ao decidir, vira versão nova
  corrigida      BOOLEAN NOT NULL DEFAULT FALSE,
  -- trava otimista: cada gravação soma 1; gravação com número velho é recusada
  trava          INTEGER NOT NULL DEFAULT 1,
  criado_em      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  atualizado_em  TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  -- lixeira: some de todas as telas com mensagens, anexos e avisos; volta
  -- inteira ao restaurar; após 30 dias a purga apaga de vez (em cascata)
  deleted_at     TIMESTAMP(3),
  deleted_by     TEXT
);
CREATE INDEX IF NOT EXISTS chat_conversa_dono_id_idx ON chat_conversa (dono_id);
CREATE INDEX IF NOT EXISTS chat_conversa_status_idx ON chat_conversa (status);
CREATE INDEX IF NOT EXISTS chat_conversa_deleted_at_idx ON chat_conversa (deleted_at);

-- Uma versão = foto completa dos três planos no momento do envio ou da
-- decisão. Não sobrescreve: corrigir ou reenviar cria a próxima.
CREATE TABLE IF NOT EXISTS chat_versao (
  id               TEXT PRIMARY KEY,
  conversa_id      TEXT NOT NULL REFERENCES chat_conversa(id) ON DELETE CASCADE,
  numero           INTEGER NOT NULL,
  -- ex.: "aprovada pelo vendedor", "corrigida e aprovada pelo gerente"
  nota             TEXT NOT NULL DEFAULT '',
  -- motivo da reprovação, quando houver
  motivo           TEXT,
  -- autor por cópia: o nome fica mesmo se o usuário sair
  criado_por_id    TEXT REFERENCES usuario(id) ON DELETE SET NULL,
  criado_por_nome  TEXT NOT NULL DEFAULT 'sistema',
  criado_em        TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  is_current       BOOLEAN NOT NULL DEFAULT FALSE,
  planos           JSONB NOT NULL,
  -- total em 12 meses por plano
  totais           JSONB NOT NULL DEFAULT '{}',
  -- o que mudou em relação à versão anterior, em frases
  mudou            JSONB NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_versao_conversa_numero_key ON chat_versao (conversa_id, numero);
CREATE INDEX IF NOT EXISTS chat_versao_conversa_idx ON chat_versao (conversa_id, criado_em);

CREATE TABLE IF NOT EXISTS chat_mensagem (
  id           TEXT PRIMARY KEY,
  conversa_id  TEXT NOT NULL REFERENCES chat_conversa(id) ON DELETE CASCADE,
  -- nulo nas mensagens do assistente e do sistema
  autor_id     TEXT REFERENCES usuario(id) ON DELETE SET NULL,
  -- usuario | assistente | sistema
  tipo         TEXT NOT NULL,
  texto        TEXT NOT NULL DEFAULT '',
  -- opções de toque, cartões dos planos, estilo do aviso
  extra        JSONB NOT NULL DEFAULT '{}',
  criado_em    TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS chat_mensagem_conversa_idx ON chat_mensagem (conversa_id, criado_em);

-- Arquivo anexado a uma mensagem, guardado no próprio banco.
CREATE TABLE IF NOT EXISTS chat_anexo (
  id           TEXT PRIMARY KEY,
  conversa_id  TEXT NOT NULL REFERENCES chat_conversa(id) ON DELETE CASCADE,
  mensagem_id  TEXT REFERENCES chat_mensagem(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL DEFAULT '',
  tamanho      INTEGER NOT NULL,
  conteudo     BYTEA NOT NULL,
  -- texto lido do arquivo (PDF, Word, planilha em texto): o assistente usa
  texto        TEXT NOT NULL DEFAULT '',
  criado_em    TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS chat_anexo_conversa_idx ON chat_anexo (conversa_id);
CREATE INDEX IF NOT EXISTS chat_anexo_mensagem_idx ON chat_anexo (mensagem_id);

CREATE TABLE IF NOT EXISTS notificacao (
  id           TEXT PRIMARY KEY,
  para_id      TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  texto        TEXT NOT NULL,
  conversa_id  TEXT REFERENCES chat_conversa(id) ON DELETE CASCADE,
  lida         BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em    TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS notificacao_para_lida_idx ON notificacao (para_id, lida);

/* ═══ trilhas (imutáveis) ═══ */

-- Histórico de CRUD. Guarda só o que mudou (antes/depois dos campos alterados),
-- para mostrar "quantidade: 10 → 25" sem inflar o banco.
CREATE TABLE IF NOT EXISTS audit_log (
  id                TEXT PRIMARY KEY,
  -- Restrict: apagar o usuário não pode apagar a autoria
  user_id           TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  -- autor por cópia: renomear ou apagar o usuário não reescreve o passado
  actor_nome        TEXT NOT NULL DEFAULT 'desconhecido (histórico)',
  actor_email       TEXT,
  actor_role        TEXT,
  -- USER | SYSTEM | ANONIMO
  actor_tipo        TEXT NOT NULL DEFAULT 'USER',
  -- TELA | ASSISTENTE | IMPORTACAO | SISTEMA
  origem            TEXT NOT NULL DEFAULT 'SISTEMA',
  -- chat_conversa | catalogo_item | usuario | …
  entity            TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  parent_entity     TEXT,
  parent_entity_id  TEXT,
  -- nome curto do fato, ex.: "proposta.enviada", "tabela.gratis"
  event             TEXT NOT NULL DEFAULT '',
  -- CREATE | UPDATE | DELETE | RESTORE | PURGE | LOGIN | LOGOUT | LOGIN_FAILED | EXPORT
  action            TEXT NOT NULL,
  before            JSONB,
  after             JSONB,
  meta              JSONB,
  campos            TEXT[] NOT NULL DEFAULT '{}',
  ip                TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_parent_idx ON audit_log (parent_entity, parent_entity_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_event_idx ON audit_log (event, created_at);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at);

-- Trilha de acesso, separada do audit_log de dados.
CREATE TABLE IF NOT EXISTS sessao_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  nome        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  -- LOGIN | LOGOUT | LOGIN_FALHOU
  evento      TEXT NOT NULL,
  motivo      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS sessao_log_created_at_idx ON sessao_log (created_at);
CREATE INDEX IF NOT EXISTS sessao_log_user_idx ON sessao_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS sessao_log_evento_idx ON sessao_log (evento, created_at);

-- Imutabilidade (igual ao Controle de Adesões, prisma/sql/audit_guard.sql):
-- trigger e não RULE nem só REVOKE — REVOKE não vale para o dono da tabela, e
-- RULE "DO INSTEAD NOTHING" apagaria sem erro. A trigger aborta com erro claro.
CREATE OR REPLACE FUNCTION audit_log_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% é imutável: % negado (id=%)', TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, '-')
    USING ERRCODE = '42501', HINT = 'O histórico não pode ser alterado nem apagado.';
END;
$$;
CREATE OR REPLACE FUNCTION audit_log_imutavel_stmt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% é imutável: % negado', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_imutavel();
DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON audit_log;
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_imutavel();
DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_imutavel_stmt();
-- 'ALWAYS': sem isso a trava some com session_replication_role = 'replica'
ALTER TABLE audit_log ENABLE ALWAYS TRIGGER trg_audit_log_no_update;
ALTER TABLE audit_log ENABLE ALWAYS TRIGGER trg_audit_log_no_delete;
ALTER TABLE audit_log ENABLE ALWAYS TRIGGER trg_audit_log_no_truncate;

DROP TRIGGER IF EXISTS trg_sessao_log_no_update ON sessao_log;
CREATE TRIGGER trg_sessao_log_no_update BEFORE UPDATE ON sessao_log FOR EACH ROW EXECUTE FUNCTION audit_log_imutavel();
DROP TRIGGER IF EXISTS trg_sessao_log_no_delete ON sessao_log;
CREATE TRIGGER trg_sessao_log_no_delete BEFORE DELETE ON sessao_log FOR EACH ROW EXECUTE FUNCTION audit_log_imutavel();
DROP TRIGGER IF EXISTS trg_sessao_log_no_truncate ON sessao_log;
CREATE TRIGGER trg_sessao_log_no_truncate BEFORE TRUNCATE ON sessao_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_imutavel_stmt();
ALTER TABLE sessao_log ENABLE ALWAYS TRIGGER trg_sessao_log_no_update;
ALTER TABLE sessao_log ENABLE ALWAYS TRIGGER trg_sessao_log_no_delete;
ALTER TABLE sessao_log ENABLE ALWAYS TRIGGER trg_sessao_log_no_truncate;

/* ═══ Supabase ═══ */

-- No Supabase, o schema public sai pela API com a chave anon. RLS ligado e sem
-- políticas = a API não lê nem grava nada; a aplicação conecta como dona das
-- tabelas e não é afetada. Num Postgres comum, não muda nada.
ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessao ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_visualizacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversa ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_versao ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mensagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_anexo ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessao_log ENABLE ROW LEVEL SECURITY;
