import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, LessThan, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { AuthChallengeEntity } from '../../db/entities/auth-challenge.entity';
import { MerchantEntity } from '../../db/entities/merchant.entity';

/** How long a login challenge stays redeemable. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface JwtPayload {
  /** Stellar address of the authenticated wallet. */
  sub: string;
  /** Merchant id, present only when this address owns a merchant account. */
  merchantId?: string;
}

/**
 * Wallet-signature authentication.
 *
 * The API previously guarded every route with `JwtAuthGuard` while providing
 * no endpoint capable of issuing a JWT — there was no login, no token service
 * and no credential of any kind. The API could not be used by anyone.
 *
 * Proving control of a Stellar keypair is the natural credential here, since
 * merchant and subscriber identities *are* Stellar addresses. There are no
 * passwords to store, leak or reset.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(AuthChallengeEntity)
    private readonly challenges: Repository<AuthChallengeEntity>,
    @InjectRepository(MerchantEntity)
    private readonly merchants: Repository<MerchantEntity>,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Issue a nonce for `address` to sign.
   *
   * The message embeds the address and an expiry so a signature captured from
   * one context cannot be replayed into another.
   */
  async createChallenge(address: string): Promise<{ message: string; expiresAt: Date }> {
    this.assertValidAddress(address);

    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    const message = [
      'SS-Billing authentication request',
      '',
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt.toISOString()}`,
      '',
      'Signing this message proves you control this account.',
      'It authorizes no payment and moves no funds.',
    ].join('\n');

    await this.challenges.save(
      this.challenges.create({ address, message, expiresAt, consumedAt: null }),
    );

    return { message, expiresAt };
  }

  /**
   * Redeem a signed challenge for a JWT.
   *
   * Returns the same `UnauthorizedException` for every failure mode so the
   * endpoint cannot be used to probe which addresses have pending challenges.
   */
  async verifyChallenge(
    address: string,
    message: string,
    signatureBase64: string,
  ): Promise<{ accessToken: string; merchantId: string | null }> {
    this.assertValidAddress(address);

    const challenge = await this.challenges.findOne({
      where: { address, message, consumedAt: IsNull() },
    });

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired challenge');
    }

    if (!this.verifySignature(address, message, signatureBase64)) {
      // Leave the challenge redeemable: a failed signature is often a wallet
      // quirk, and burning the nonce would turn that into a denial of service.
      this.logger.warn(`Signature verification failed for ${address}`);
      throw new UnauthorizedException('Invalid or expired challenge');
    }

    // Atomic single-use consumption. The WHERE clause on consumedAt means a
    // concurrent redemption of the same challenge affects zero rows.
    const consumed = await this.challenges.update(
      { id: challenge.id, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (consumed.affected !== 1) {
      throw new UnauthorizedException('Invalid or expired challenge');
    }

    const merchant = await this.merchants.findOne({ where: { id: address } });

    const payload: JwtPayload = {
      sub: address,
      ...(merchant ? { merchantId: merchant.id } : {}),
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      merchantId: merchant?.id ?? null,
    };
  }

  private verifySignature(address: string, message: string, signatureBase64: string): boolean {
    try {
      const signature = Buffer.from(signatureBase64, 'base64');
      // Base64 that decodes to nothing would otherwise reach verify() as an
      // empty buffer and produce a confusing library error.
      if (signature.length === 0) return false;

      return Keypair.fromPublicKey(address).verify(Buffer.from(message, 'utf8'), signature);
    } catch {
      return false;
    }
  }

  private assertValidAddress(address: string): void {
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new UnauthorizedException('Invalid Stellar address');
    }
  }

  /** Consumed and expired challenges have no further value; drop them. */
  @Cron(CronExpression.EVERY_HOUR)
  async pruneExpiredChallenges(): Promise<void> {
    const result = await this.challenges.delete({ expiresAt: LessThan(new Date()) });
    if (result.affected) {
      this.logger.debug(`Pruned ${result.affected} expired auth challenges`);
    }
  }
}
