-- 0003_base_conhecimento — o que a IA aprende: propostas aprovadas e documentos
-- inseridos na plataforma (PRDs, manuais, planilhas), fatiados em trechos com
-- o vetor de cada um, para o assistente buscar por significado.
--
-- Mesmo desenho do E- Propostas (base_documento + base_trecho, 1536 dimensões,
-- índice HNSW), com origem, situação e lixeira.
-- Regra (Leo, 03/11/2026): proposta aprovada entra como PADRÃO, sem nome de
-- cliente, cidade ou vendedor — um vendedor aprende com o que foi aprovado por
-- todos sem ver o negócio de outro. Preço NÃO sai daqui: vem do catálogo.
-- Idempotente: reaplicar não estraga.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS base_documento (
  id              TEXT PRIMARY KEY,
  -- proposta_aprovada (gerada pelo sistema) | arquivo (enviado em Configurações)
  origem          TEXT NOT NULL,
  -- proposta_aprovada: o id da chat_conversa; arquivo: nulo
  ref_id          TEXT,
  titulo          TEXT NOT NULL,
  -- solucao | escopo | proposta | preco | manual | outro
  categoria       TEXT NOT NULL DEFAULT 'outro',
  -- valor do campo Solução do HubSpot (vazio = vale para todas)
  solucao         TEXT NOT NULL DEFAULT '',
  -- publico | privado | vazio
  setor           TEXT NOT NULL DEFAULT '',
  arquivo         TEXT NOT NULL DEFAULT '',
  tipo            TEXT NOT NULL DEFAULT '',
  tamanho         INTEGER NOT NULL DEFAULT 0,
  -- o arquivo original (só origem = arquivo)
  conteudo        BYTEA,
  -- o texto que vira trechos (proposta: já anonimizada)
  texto           TEXT NOT NULL DEFAULT '',
  caracteres      INTEGER NOT NULL DEFAULT 0,
  -- md5 do texto: só vetoriza de novo quando o texto muda
  hash            TEXT NOT NULL,
  -- pendente | pronto | erro
  situacao        TEXT NOT NULL DEFAULT 'pendente',
  erro            TEXT,
  trechos         INTEGER NOT NULL DEFAULT 0,
  enviado_por_id  TEXT REFERENCES usuario(id) ON DELETE SET NULL,
  criado_em       TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  atualizado_em   TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  deleted_at      TIMESTAMP(3),
  deleted_by      TEXT
);
-- uma proposta aprovada vira um documento só
CREATE UNIQUE INDEX IF NOT EXISTS base_documento_ref_vivo_key ON base_documento (origem, ref_id) WHERE ref_id IS NOT NULL AND deleted_at IS NULL;
-- o mesmo arquivo não entra duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS base_documento_arquivo_vivo_key ON base_documento (hash) WHERE origem = 'arquivo' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS base_documento_situacao_idx ON base_documento (situacao);
CREATE INDEX IF NOT EXISTS base_documento_deleted_at_idx ON base_documento (deleted_at);

CREATE TABLE IF NOT EXISTS base_trecho (
  id            TEXT PRIMARY KEY,
  documento_id  TEXT NOT NULL REFERENCES base_documento(id) ON DELETE CASCADE,
  ordem         INTEGER NOT NULL,
  texto         TEXT NOT NULL,
  -- text-embedding-3-small, 1536 dimensões
  vetor         extensions.vector(1536) NOT NULL,
  criado_em     TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS base_trecho_documento_id_idx ON base_trecho (documento_id);
CREATE INDEX IF NOT EXISTS base_trecho_vetor_idx ON base_trecho USING hnsw (vetor extensions.vector_cosine_ops);

ALTER TABLE base_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_trecho ENABLE ROW LEVEL SECURITY;
