import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { PrismaClient } from '../generated/prisma/client.js';
import { readConfig } from '../config.js';

export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');

@Injectable()
export class PrismaDatabase extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const config = readConfig(process.env);
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class RedisConnection implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    const config = readConfig(process.env);
    this.client = new Redis(config.redisUrl, {
      connectTimeout: 1500,
      commandTimeout: 2000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    this.client.on('error', () => {});
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [
    PrismaDatabase,
    RedisConnection,
    { provide: DATABASE, useExisting: PrismaDatabase },
    {
      provide: REDIS,
      useFactory: (connection: RedisConnection) => connection.client,
      inject: [RedisConnection],
    },
  ],
  exports: [DATABASE, REDIS],
})
export class DatabaseModule {}
