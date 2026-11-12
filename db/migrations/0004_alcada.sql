-- 0004_alcada — quanto cada gerente pode aprovar (A-04 do PRD).
-- Nulo = sem limite, como no E- Propostas: quem já é gerente continua igual até
-- alguém definir um teto em Configurações › Usuários.
-- Idempotente: reaplicar não estraga.

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS teto_aprovacao NUMERIC(14,2);
