-- Seed: fup_config + prompt de follow-up (key='fup') do Brain Echo
-- SEED-02/SEED-03: FUP passa a funcionar out-of-the-box em banco novo, sem SQL manual.
-- ON CONFLICT DO NOTHING garante idempotência (SEED-04 — seguro rodar múltiplas vezes).
-- CRÍTICO: brain_type = 'echo' deve ser idêntico ao brainType do Brain Echo em brain.ts.
-- Este arquivo é lido por runBrainSeed() (packages/database/src/seed.ts) — NÃO é rastreado
-- pelo drizzle e NÃO deve ser copiado para packages/database/src/migrations/ (SEED-05).

-- D-01/D-02/D-03/D-04: mesmo default de fup_config usado em todos os brain_types desta fase.
-- intervals_seconds: 1h -> 1d -> 3d (3 tentativas). Horário comercial BR, seg-sex, 8h-18h.
-- NOTA: literal de array via chaves '{...}' (sintaxe alternativa ao construtor ARRAY do
-- Postgres) — evita colchetes no arquivo, que poderiam ser confundidos com placeholder
-- marker; mesma semântica de array, mesmo resultado.
INSERT INTO fup_config (brain_type, enabled, intervals_seconds, min_hour, max_hour, allowed_days, timezone)
VALUES (
  'echo',
  true,
  '{3600,86400,259200}',
  8,
  18,
  '{mon,tue,wed,thu,fri}',
  'America/Sao_Paulo'
)
ON CONFLICT (brain_type) DO NOTHING;

-- D-05/D-06: prompt genérico, production-ready — pode ir pro ar sem edição obrigatória.
INSERT INTO prompts (brain_type, key, content)
VALUES (
  'echo',
  'fup',
  'Você é o assistente responsável por enviar mensagens de retomada (follow-up) para leads que pararam de responder durante uma conversa de validação no WhatsApp. Com base no histórico da conversa fornecido, escreva uma mensagem curta (entre 1 e 3 frases), cordial e profissional, adequada ao tom de uma conversa por WhatsApp, para reengajar o lead de forma natural, sem parecer insistente ou repetitivo. Nunca repita literalmente uma mensagem já enviada anteriormente na conversa; escreva um texto novo que se conecte ao contexto da última interação. Se o histórico disponível não for suficiente para saber exatamente o que perguntar, pergunte educadamente se o lead ainda tem interesse em continuar a conversa. Nunca revele que é uma inteligência artificial, a menos que o lead pergunte diretamente.'
)
ON CONFLICT (brain_type, key) DO NOTHING;
