-- 0007_cargos_permissoes — cargo e permissão separados (ABAC), decisão do Leo de 11/11/2026.
-- Cargo (o que a pessoa faz): vendedor | supervisor | gerente | desenvolvedor.
--   A alçada segue o cargo: supervisor aprova abaixo de R$ 1 milhão, gerente a partir de R$ 1 milhão.
-- Permissão (o que pode configurar): membro | admin | superadmin.
--   admin muda preços, itens, modalidades e base; superadmin também cuida dos usuários.
-- aprovador_final: o último nível (o Natanel). Vê tudo e aprova o que ninguém abaixo pode.
-- Quem já existe continua com os mesmos poderes: gerente vira cargo gerente + superadmin, vendedor vira vendedor + membro.
-- A coluna papel fica (legado, audit_log antigo); teto_aprovacao deixa de ser usado. Idempotente.

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS cargo TEXT;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS permissao TEXT;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS aprovador_final BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE usuario SET cargo = CASE WHEN papel = 'gerente' THEN 'gerente' ELSE 'vendedor' END WHERE cargo IS NULL;
UPDATE usuario SET permissao = CASE WHEN papel = 'gerente' THEN 'superadmin' ELSE 'membro' END WHERE permissao IS NULL;

ALTER TABLE usuario ALTER COLUMN cargo SET DEFAULT 'vendedor';
ALTER TABLE usuario ALTER COLUMN cargo SET NOT NULL;
ALTER TABLE usuario ALTER COLUMN permissao SET DEFAULT 'membro';
ALTER TABLE usuario ALTER COLUMN permissao SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuario_cargo_check') THEN
    ALTER TABLE usuario ADD CONSTRAINT usuario_cargo_check CHECK (cargo IN ('vendedor', 'supervisor', 'gerente', 'desenvolvedor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuario_permissao_check') THEN
    ALTER TABLE usuario ADD CONSTRAINT usuario_permissao_check CHECK (permissao IN ('membro', 'admin', 'superadmin'));
  END IF;
END $$;
