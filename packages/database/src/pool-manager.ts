import postgres from 'postgres';
import { LRUCache } from 'lru-cache';
import type { Sql } from 'postgres';

interface PoolConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  max: number;              // D-09: 10-20 connections per pool
  idle_timeout: number;     // D-11: 300 = 5 minutes
}

export class TenantPoolManager {
  private pools: LRUCache<string, Sql>;
  private baseConfig: PoolConfig;

  constructor(config: PoolConfig, maxTenants = 20) {
    this.baseConfig = config;

    // D-10: LRU cache for 20 tenants max
    this.pools = new LRUCache<string, Sql>({
      max: maxTenants,
      dispose: (pool, dbName) => {
        // D-12: Cleanup when evicted
        pool.end({ timeout: 5 });
        console.info(`Pool for tenant ${dbName} evicted and closed`);
      },
    });
  }

  getPool(databaseName: string): Sql {
    let pool = this.pools.get(databaseName);

    if (!pool) {
      pool = postgres({
        ...this.baseConfig,
        database: databaseName,
        max: this.baseConfig.max,
        idle_timeout: this.baseConfig.idle_timeout,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onnotice: () => {},
      });

      this.pools.set(databaseName, pool);
      console.info(`Created new pool for tenant ${databaseName}`);
    }

    return pool;
  }

  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const [dbName, pool] of this.pools.entries()) {
      closePromises.push(
        pool.end({ timeout: 5 }).catch(err =>
          console.error(`Error closing pool for ${dbName}:`, err)
        )
      );
    }
    await Promise.all(closePromises);
    this.pools.clear();
  }
}
