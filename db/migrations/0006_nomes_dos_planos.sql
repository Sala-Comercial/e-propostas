-- 0006_nomes_dos_planos — novos nomes dos planos (Leo, 05/11/2026).
--   basico → minimal  ·  pro → premium  ·  premium → ai_driven
-- Atenção: "premium" muda de sentido (era o mais alto, agora é o do meio). Só mexe em
-- linha que ainda tem a chave antiga "basico" nos planos, então reaplicar não estraga.
-- O audit_log é imutável e continua com os nomes antigos: é a história como ela foi.

CREATE OR REPLACE FUNCTION renomear_planos(j JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL OR jsonb_typeof(j) <> 'object' THEN j ELSE coalesce((
    SELECT jsonb_object_agg(CASE chave WHEN 'basico' THEN 'minimal' WHEN 'pro' THEN 'premium' WHEN 'premium' THEN 'ai_driven' ELSE chave END, valor)
    FROM jsonb_each(j) AS t(chave, valor)), '{}'::jsonb) END
$$;

-- os planos, o preço estimado e a tabela da calculadora ficam por plano dentro do estado
UPDATE chat_conversa
SET estado = estado
  || jsonb_build_object('planos', renomear_planos(estado->'planos'))
  || CASE WHEN estado ? 'precoEstimado' THEN jsonb_build_object('precoEstimado', renomear_planos(estado->'precoEstimado')) ELSE '{}'::jsonb END
  || CASE WHEN estado ? 'calculadora' THEN jsonb_build_object('calculadora', renomear_planos(estado->'calculadora')) ELSE '{}'::jsonb END
WHERE estado->'planos' ? 'basico';

UPDATE chat_versao
SET totais = renomear_planos(totais) || CASE WHEN totais ? 'calculadora' THEN jsonb_build_object('calculadora', renomear_planos(totais->'calculadora')) ELSE '{}'::jsonb END,
    planos = renomear_planos(planos)
WHERE planos ? 'basico';

DROP FUNCTION renomear_planos(JSONB);
