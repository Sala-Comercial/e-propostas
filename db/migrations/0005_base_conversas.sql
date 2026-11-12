-- 0005_base_conversas — o chat aprende com tudo (Leo, 05/11/2026).
-- Novas origens em base_documento:
--   conversa     a conversa inteira. Tem nomes, então só o próprio dono encontra (regra ética da SASI).
--   aprendizado  o que o gerente reprovou ou corrigiu, sem nomes: vale para todos os vendedores.
-- Idempotente: reaplicar não estraga.

ALTER TABLE base_documento ADD COLUMN IF NOT EXISTS dono_id TEXT REFERENCES usuario(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS base_documento_dono_id_idx ON base_documento (dono_id);
