import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as path from 'path';

/**
 * Data source for the TypeORM CLI (migration:run, migration:generate).
 *
 * `dotenv/config` is imported because the CLI runs outside the Nest container
 * and therefore never loads ConfigModule — without it DATABASE_URL is
 * undefined and every migration command fails with an unhelpful connection
 * error.
 */
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run migrations');
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [path.join(__dirname, 'entities', '*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, 'migrations', '*{.ts,.js}')],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});

export default AppDataSource;
