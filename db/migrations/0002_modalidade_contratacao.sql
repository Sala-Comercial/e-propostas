-- 0002_modalidade_contratacao — textos da página 3 da proposta ("Recomendação
-- de modalidade de contratação"), um por modalidade.
--
-- Texto jurídico vai a cliente: fica no banco (o gerente edita em
-- Configurações › Modalidades, sem nova versão do sistema) e só conta como
-- pronto depois que alguém marca "validado pelo Jurídico" (validado_por/em).
-- Editar o texto tira a validação. Toda mudança vai para o audit_log.
--
-- Placeholders nos textos: {solucao}, {cliente}, {local} (ex.: "Município de
-- Aliança — PE"), {administracao} ("Administração Municipal" ou "Estadual").
-- Idempotente: reaplicar não muda o que já foi editado.

CREATE TABLE IF NOT EXISTS modalidade_contratacao (
  id                 TEXT PRIMARY KEY,
  nome               TEXT NOT NULL,
  fundamentacao      TEXT NOT NULL,
  objeto             TEXT NOT NULL,
  -- [{ "titulo", "subtitulo", "itens": [..] }] — um ou dois quadros
  quadros            JSONB NOT NULL DEFAULT '[]',
  -- [{ "titulo", "texto" }]
  vantagens          JSONB NOT NULL DEFAULT '[]',
  validado_por       TEXT,
  validado_em        TIMESTAMP(3),
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  ordem              INTEGER NOT NULL DEFAULT 0,
  atualizado_por_id  TEXT REFERENCES usuario(id) ON DELETE SET NULL,
  atualizado_em      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  deleted_at         TIMESTAMP(3),
  deleted_by         TEXT
);
CREATE INDEX IF NOT EXISTS modalidade_contratacao_deleted_at_idx ON modalidade_contratacao (deleted_at);
ALTER TABLE modalidade_contratacao ENABLE ROW LEVEL SECURITY;

-- Objeto comum (igual ao do modelo da proposta de Aliança, sem o nome do Cidade na Mão).
INSERT INTO modalidade_contratacao (id, nome, ordem, fundamentacao, objeto, quadros, vantagens) VALUES
(
  'ata_inexigibilidade', 'ATA de registro de preços por inexigibilidade + adesão', 1,
  'Com fundamento no art. 74, inciso IV, da Lei Federal n.º 14.133/2021 (Nova Lei de Licitações e Contratos Administrativos), a contratação poderá ser realizada por Inexigibilidade de Licitação, haja vista a natureza singular do objeto e a notória especialização da empresa fornecedora, cujo reconhecimento de mercado é atestado por certificações ISO 27001, conformidade LGPD e mais de 1 milhão de downloads na plataforma.',
  'Contratação de solução tecnológica integrada de comunicação digital, sob o modelo de Software como Serviço (SaaS) customizável, compreendendo o licenciamento de plataforma móvel adaptável à identidade visual e às necessidades específicas da {administracao}, bem como sua implementação, operação, suporte técnico e fornecimento de módulos denominada {solucao}, destinada à modernização dos serviços públicos e ao fortalecimento do relacionamento entre a {administracao} e os cidadãos do {local}.',
  '[{"titulo":"ATA DE REGISTRO DE PREÇOS","subtitulo":"por Inexigibilidade","itens":["Art. 74, IV — Lei 14.133/2021","Fornecedor de notória especialização","Objeto de natureza singular","Preços registrados e vinculados","Vigência de até 12 meses, prorrogável"]},
    {"titulo":"Adesão da ATA","subtitulo":"Carona — Art. 86, Lei 14.133/2021","itens":["Outros entes podem aderir à ATA","Sem novo processo licitatório","Amplia alcance do contrato vigente","Quantidade e itens flexíveis","Economia de escala ao município"]}]',
  '[{"titulo":"Escalabilidade contratual","texto":"A ATA de Registro de Preços permite ao órgão aderir a novos módulos de forma incremental, sem a necessidade de novo processo de contratação."},
    {"titulo":"Economicidade","texto":"Os preços registrados ficam vinculados por todo o período de vigência, assegurando as condições negociadas e os descontos já concedidos ao ente público."},
    {"titulo":"Conformidade legal","texto":"A combinação Inexigibilidade + ATA de Registro de Preços está em plena consonância com a Lei 14.133/2021, garantindo segurança jurídica ao ordenador de despesa."}]'
),
(
  'inexigibilidade', 'Inexigibilidade de licitação', 2,
  'Com fundamento no art. 74 da Lei Federal n.º 14.133/2021 (Nova Lei de Licitações e Contratos Administrativos), a contratação poderá ser realizada por Inexigibilidade de Licitação, diante da inviabilidade de competição decorrente da natureza singular do objeto e da notória especialização da empresa fornecedora, atestada por certificações ISO 27001, conformidade LGPD e mais de 1 milhão de downloads na plataforma.',
  'Contratação de solução tecnológica integrada de comunicação digital, sob o modelo de Software como Serviço (SaaS) customizável, compreendendo o licenciamento de plataforma móvel adaptável à identidade visual e às necessidades específicas da {administracao}, bem como sua implementação, operação, suporte técnico e fornecimento de módulos denominada {solucao}, destinada à modernização dos serviços públicos e ao fortalecimento do relacionamento entre a {administracao} e os cidadãos do {local}.',
  '[{"titulo":"INEXIGIBILIDADE DE LICITAÇÃO","subtitulo":"Art. 74 — Lei 14.133/2021","itens":["Inviabilidade de competição","Fornecedor de notória especialização","Objeto de natureza singular","Contratação direta, com justificativa de preço","Processo mais curto que a licitação"]}]',
  '[{"titulo":"Agilidade","texto":"A contratação direta dispensa as fases de disputa da licitação, permitindo iniciar a implementação em menos tempo."},
    {"titulo":"Solução sob medida","texto":"O objeto é contratado como foi desenhado para o órgão, sem perder módulos ou condições na disputa por menor preço."},
    {"titulo":"Conformidade legal","texto":"A inexigibilidade está prevista na Lei 14.133/2021 e se apoia na justificativa da singularidade do objeto e da notória especialização do fornecedor."}]'
),
(
  'dispensa', 'Dispensa de licitação', 3,
  'Com fundamento no art. 75, inciso II, da Lei Federal n.º 14.133/2021 (Nova Lei de Licitações e Contratos Administrativos), a contratação poderá ser realizada por Dispensa de Licitação, por se tratar de valor inferior ao limite legal vigente, atualizado anualmente por decreto, observadas a pesquisa de preços e a publicação no Portal Nacional de Contratações Públicas (PNCP).',
  'Contratação de solução tecnológica integrada de comunicação digital, sob o modelo de Software como Serviço (SaaS) customizável, compreendendo o licenciamento de plataforma móvel adaptável à identidade visual e às necessidades específicas da {administracao}, bem como sua implementação, operação, suporte técnico e fornecimento de módulos denominada {solucao}, destinada à modernização dos serviços públicos e ao fortalecimento do relacionamento entre a {administracao} e os cidadãos do {local}.',
  '[{"titulo":"DISPENSA DE LICITAÇÃO","subtitulo":"Art. 75, II — Lei 14.133/2021","itens":["Valor dentro do limite anual da lei","Contratação direta e ágil","Pesquisa de preços e justificativa","Publicação no PNCP","Ideal para começar com um módulo"]}]',
  '[{"titulo":"Agilidade","texto":"A dispensa por valor permite contratar em poucas semanas, com um processo administrativo simples."},
    {"titulo":"Começo enxuto","texto":"O órgão começa pelo essencial e amplia depois, conforme os resultados aparecem."},
    {"titulo":"Conformidade legal","texto":"A dispensa por valor está prevista na Lei 14.133/2021, respeitado o limite anual atualizado por decreto."}]'
),
(
  'adesao_ata', 'Adesão a ATA de registro de preços', 4,
  'Com fundamento no art. 86, § 2º, da Lei Federal n.º 14.133/2021 (Nova Lei de Licitações e Contratos Administrativos), a contratação poderá ser realizada por Adesão a Ata de Registro de Preços vigente, mediante justificativa da vantagem da adesão, demonstração de que os valores registrados são compatíveis com os de mercado e prévia consulta e aceitação do órgão gerenciador e do fornecedor.',
  'Contratação de solução tecnológica integrada de comunicação digital, sob o modelo de Software como Serviço (SaaS) customizável, compreendendo o licenciamento de plataforma móvel adaptável à identidade visual e às necessidades específicas da {administracao}, bem como sua implementação, operação, suporte técnico e fornecimento de módulos denominada {solucao}, destinada à modernização dos serviços públicos e ao fortalecimento do relacionamento entre a {administracao} e os cidadãos do {local}.',
  '[{"titulo":"ADESÃO A ATA","subtitulo":"Carona — Art. 86, § 2º, Lei 14.133/2021","itens":["Ata vigente de outro órgão","Sem novo processo licitatório","Preços já registrados e vantajosos","Anuência do órgão gerenciador e do fornecedor","Respeito aos limites de quantidade da lei"]}]',
  '[{"titulo":"Rapidez","texto":"O órgão aproveita uma ata já licitada e vigente, sem repetir todo o processo de contratação."},
    {"titulo":"Economicidade","texto":"Os preços registrados já passaram por disputa e por pesquisa de mercado, o que facilita a justificativa de vantagem."},
    {"titulo":"Conformidade legal","texto":"A adesão está prevista no art. 86 da Lei 14.133/2021, dentro dos limites e condições ali estabelecidos."}]'
)
ON CONFLICT (id) DO NOTHING;
