import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { Sql } from 'postgres';

/**
 * Retorna true se o erro PostgreSQL indica que o lock não estava disponível (código 55P03).
 * Duplicado (não importado) de migrate.ts — seed.ts não deve importar nem modificar migrate.ts,
 * apenas espelhar seu formato (SEED-05).
 */
function isLockNotAvailable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '55P03' // lock_not_available (PostgreSQL)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * SEED-02/SEED-03: Seed por tipo de Brain — mecanismo separado de runMigrations(), NÃO
 * rastreado pelo drizzle. Chamado pelo BrainRunner.init() entre runMigrations() e loadPrompts().
 *
 * Recebe Sql injetado — sem criar nova conexão. Lança erro em caso de falha — a decisão de
 * terminar o processo cabe inteiramente ao caller (BrainRunner.init()), mesmo contrato
 * "throw-not-exit" de runMigrations().
 *
 * D-08/D-09: ao final do seed, valida que fup_config e prompts(key='fup') existem para
 * brainType; se algo faltar, lança um Error nomeando o brainType e qual linha está ausente —
 * fail-fast, no mesmo lock/escopo do resto do seed (não um segundo mecanismo de lock).
 *
 * SEED-04: idempotente — os arquivos .sql do seedsFolder usam ON CONFLICT DO NOTHING, então
 * chamar runBrainSeed() múltiplas vezes contra o mesmo banco não duplica linhas nem lança erro.
 */
export async function runBrainSeed(sql: Sql, brainType: string, seedsFolder: string): Promise<void> {
  // Bootstrap idempotente da tabela de lock — DDL fora de transação, mesma forma de migrate.ts.
  // Torna runBrainSeed() seguro de chamar isoladamente (ex: em testes) sem depender de
  // runMigrations() ter rodado antes no mesmo processo.
  await sql`CREATE TABLE IF NOT EXISTS _schema_lock (id INTEGER PRIMARY KEY, locked_at TIMESTAMPTZ)`;
  await sql`INSERT INTO _schema_lock (id, locked_at) VALUES (1, NOW()) ON CONFLICT (id) DO NOTHING`;

  // Ler o conteúdo de todos os arquivos .sql uma única vez, antes do retry loop — I/O de
  // arquivo não deve ser repetido em cada tentativa de lock.
  const entries = await readdir(seedsFolder);
  const sqlFileNames = entries.filter((name) => name.endsWith('.sql')).sort();
  const fileContents: string[] = [];
  for (const fileName of sqlFileNames) {
    fileContents.push(await readFile(join(seedsFolder, fileName), 'utf-8'));
  }

  // Retry até 3 tentativas com 200ms de sleep entre elas — idêntico em forma a runMigrations().
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      await sql.begin(async (tx) => {
        // FOR UPDATE NOWAIT: lança erro código 55P03 se outra instância tem o lock
        await tx`SELECT id FROM _schema_lock WHERE id = 1 FOR UPDATE NOWAIT`;

        // Executa cada arquivo de seed, em ordem, via protocolo simples (multi-statement,
        // sem interpolação de parâmetros — conteúdo é literal, definido em build-time).
        for (const content of fileContents) {
          await tx.unsafe(content);
        }

        // D-08/D-09: validação fail-fast — confirma que o seed de fato inseriu as linhas
        // esperadas para este brainType. Falha aqui propaga imediatamente, sem retry (não é
        // um erro de lock).
        const fupConfigRows = await tx`SELECT 1 FROM fup_config WHERE brain_type = ${brainType}`;
        if (fupConfigRows.length === 0) {
          throw new Error(
            `[seed] fup_config ausente para brain_type='${brainType}' após runBrainSeed(). ` +
            `Verifique packages/database/src/seeds/${brainType}/ para diagnóstico.`
          );
        }

        const fupPromptRows = await tx`SELECT 1 FROM prompts WHERE brain_type = ${brainType} AND key = 'fup'`;
        if (fupPromptRows.length === 0) {
          throw new Error(
            `[seed] prompts(key='fup') ausente para brain_type='${brainType}' após runBrainSeed(). ` +
            `Verifique packages/database/src/seeds/${brainType}/ para diagnóstico.`
          );
        }
        // Lock liberado automaticamente ao fim da transação
      });
      return; // Sucesso — sair do loop
    } catch (err: unknown) {
      if (isLockNotAvailable(err) && attempt < MAX_RETRIES - 1) {
        attempt++;
        await sleep(200);
        continue;
      }
      if (isLockNotAvailable(err)) {
        throw new Error(
          `[seed] Não foi possível adquirir lock de seed após ${MAX_RETRIES} tentativas ` +
          `para brain_type='${brainType}'. Outra instância pode estar executando o seed. ` +
          'Reinicie a aplicação.'
        );
      }
      // Outros erros (incluindo a validação fail-fast acima) — propagar imediatamente, sem retry
      throw err;
    }
  }
}
