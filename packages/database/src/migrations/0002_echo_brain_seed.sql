-- Seed: system prompt do Echo Brain
-- D-06: System prompt seedado via migration SQL para rodar automaticamente no startup
-- ON CONFLICT DO NOTHING garante idempotência (seguro rodar múltiplas vezes)
-- UNIQUE INDEX em (brain_type, key) foi criado em 0001_lazy_deathstrike.sql

INSERT INTO prompts (brain_type, key, content)
VALUES (
  'echo',
  'system',
  'Você é um assistente útil. Responda às perguntas do usuário de forma clara e concisa. Se não souber a resposta, diga isso honestamente.'
)
ON CONFLICT (brain_type, key) DO NOTHING;
