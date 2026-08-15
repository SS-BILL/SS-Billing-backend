import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { AuthService, JwtPayload } from './auth.service';
import { AuthChallengeEntity } from '../../db/entities/auth-challenge.entity';
import { MerchantEntity } from '../../db/entities/merchant.entity';

/**
 * Wallet-signature login is the only credential this API has, so every failure
 * mode below is an authentication bypass or a denial of service if it
 * regresses. Signatures are produced with real Stellar keypairs — mocking the
 * crypto would make these tests assert nothing.
 */
describe('AuthService', () => {
  const keypair = Keypair.random();
  const address = keypair.publicKey();

  let service: AuthService;
  let challenges: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let merchants: { findOne: jest.Mock };
  let jwt: { signAsync: jest.Mock };

  const signMessage = (message: string, signer: Keypair = keypair): string =>
    signer.sign(Buffer.from(message, 'utf8')).toString('base64');

  const challengeRow = (message: string, overrides: Partial<AuthChallengeEntity> = {}) =>
    ({
      id: 'challenge-1',
      address,
      message,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as AuthChallengeEntity;

  beforeEach(async () => {
    challenges = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (row) => ({ id: 'challenge-1', ...row })),
      findOne: jest.fn(),
      update: jest.fn(async () => ({ affected: 1 })),
      delete: jest.fn(async () => ({ affected: 0 })),
    };
    merchants = { findOne: jest.fn(async () => null) };
    jwt = { signAsync: jest.fn(async () => 'signed.jwt.token') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(AuthChallengeEntity), useValue: challenges },
        { provide: getRepositoryToken(MerchantEntity), useValue: merchants },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('createChallenge', () => {
    it.each([
      ['an empty string', ''],
      ['a non-Stellar string', 'not-a-stellar-address'],
      ['a secret seed instead of a public key', Keypair.random().secret()],
      ['a well-formed key with a broken checksum', `${address.slice(0, -1)}A`],
      ['an Ethereum address', '0x1234567890123456789012345678901234567890'],
    ])('rejects %s', async (_label, candidate) => {
      await expect(service.createChallenge(candidate)).rejects.toThrow(UnauthorizedException);
      // Nothing may be persisted for an address we could not validate.
      expect(challenges.save).not.toHaveBeenCalled();
    });

    it('embeds the address and a fresh nonce in the signed message', async () => {
      const { message, expiresAt } = await service.createChallenge(address);

      expect(message).toContain(`Address: ${address}`);
      // Binding the address into the message is what stops a signature
      // captured for one account being replayed as another.
      expect(message).toMatch(/^Nonce: [0-9a-f]{64}$/m);
      expect(message).toContain(`Expires: ${expiresAt.toISOString()}`);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('issues a different nonce on every call', async () => {
      const first = await service.createChallenge(address);
      const second = await service.createChallenge(address);
      expect(first.message).not.toEqual(second.message);
    });

    it('persists the challenge unconsumed', async () => {
      const { message, expiresAt } = await service.createChallenge(address);
      expect(challenges.save).toHaveBeenCalledWith(
        expect.objectContaining({ address, message, expiresAt, consumedAt: null }),
      );
    });
  });

  describe('verifyChallenge', () => {
    it('returns a token for a correctly signed challenge', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));

      const result = await service.verifyChallenge(address, message, signMessage(message));

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.merchantId).toBeNull();
    });

    it('consumes the challenge exactly once, conditionally on it being unconsumed', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));

      await service.verifyChallenge(address, message, signMessage(message));

      expect(challenges.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'challenge-1' }),
        expect.objectContaining({ consumedAt: expect.any(Date) }),
      );
      // The consumedAt IS NULL predicate is what makes the update atomic
      // across replicas; without it two pods accept the same signature.
      const [criteria] = challenges.update.mock.calls[0];
      expect(Object.keys(criteria)).toContain('consumedAt');
    });

    it('rejects a signature made by a different keypair', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));
      const impostor = Keypair.random();

      await expect(
        service.verifyChallenge(address, message, signMessage(message, impostor)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a signature over a message other than the one presented', async () => {
      const { message } = await service.createChallenge(address);
      const tampered = message.replace('Signing this message proves', 'This message proves');
      challenges.findOne.mockResolvedValue(challengeRow(tampered));

      // Signed the original text, presenting the altered text.
      await expect(
        service.verifyChallenge(address, tampered, signMessage(message)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ['an empty signature', ''],
      ['base64 that decodes to nothing', '===='],
      ['garbage bytes', Buffer.from('not a signature').toString('base64')],
    ])('rejects %s without throwing a non-auth error', async (_label, signature) => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));

      await expect(service.verifyChallenge(address, message, signature)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does NOT consume the challenge when signature verification fails', async () => {
      // Burning the nonce on a bad signature turns a wallet quirk into a
      // denial of service: the user could never retry the same challenge.
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));

      await expect(
        service.verifyChallenge(address, message, signMessage(message, Keypair.random())),
      ).rejects.toThrow(UnauthorizedException);

      expect(challenges.update).not.toHaveBeenCalled();
    });

    it('rejects an expired challenge even when the signature is valid', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(
        challengeRow(message, { expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.verifyChallenge(address, message, signMessage(message))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(challenges.update).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('rejects when no matching unconsumed challenge exists', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(null);

      await expect(service.verifyChallenge(address, message, signMessage(message))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the conditional consume reports affected: 0', async () => {
      // The concurrent-redemption race: another request consumed this
      // challenge between our read and our update. Issuing a token here
      // would make a single-use nonce usable twice.
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));
      challenges.update.mockResolvedValue({ affected: 0 });

      await expect(service.verifyChallenge(address, message, signMessage(message))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('rejects an address that is not a Stellar public key before touching the database', async () => {
      await expect(service.verifyChallenge('nope', 'message', 'sig')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(challenges.findOne).not.toHaveBeenCalled();
    });

    it('omits merchantId from the JWT payload when the address owns no merchant', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));
      merchants.findOne.mockResolvedValue(null);

      const result = await service.verifyChallenge(address, message, signMessage(message));

      const payload = jwt.signAsync.mock.calls[0][0] as JwtPayload;
      expect(payload.sub).toBe(address);
      expect(payload).not.toHaveProperty('merchantId');
      expect(result.merchantId).toBeNull();
    });

    it('carries merchantId in the JWT payload when a merchant row exists', async () => {
      const { message } = await service.createChallenge(address);
      challenges.findOne.mockResolvedValue(challengeRow(message));
      merchants.findOne.mockResolvedValue({ id: address } as MerchantEntity);

      const result = await service.verifyChallenge(address, message, signMessage(message));

      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: address, merchantId: address });
      expect(result.merchantId).toBe(address);
    });
  });

  describe('pruneExpiredChallenges', () => {
    it('deletes challenges past their expiry', async () => {
      challenges.delete.mockResolvedValue({ affected: 3 });
      await service.pruneExpiredChallenges();
      expect(challenges.delete).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: expect.anything() }),
      );
    });
  });
});
