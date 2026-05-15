import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
}));

export const stellarConfig = registerAs('stellar', () => ({
  network: process.env.STELLAR_NETWORK ?? 'testnet',
  rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  contractId: process.env.CONTRACT_ID ?? '',
  signerSecret: process.env.SIGNER_SECRET ?? '',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
}));
