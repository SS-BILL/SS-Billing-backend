import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { MerchantEntity } from '../../db/entities/merchant.entity';
import { RegisterMerchantDto, UpdateMerchantDto } from './merchant.dto';

/** Human-recognisable prefix so a leaked key is identifiable in logs or a repo. */
const API_KEY_PREFIX = 'ssb_';
const API_KEY_BYTES = 32;

@Injectable()
export class MerchantService {
  constructor(
    @InjectRepository(MerchantEntity)
    private readonly repo: Repository<MerchantEntity>,
  ) {}

  /**
   * API keys are stored as SHA-256 digests, never in plaintext.
   *
   * A fast hash is the right choice here, unlike for passwords: the key is 32
   * bytes of CSPRNG output, so there is no dictionary to attack and no benefit
   * to a work factor that would add latency to every authenticated request.
   */
  static hashApiKey(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  private generateApiKey(): { key: string; hash: string; prefix: string } {
    const key = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('hex')}`;
    return {
      key,
      hash: MerchantService.hashApiKey(key),
      prefix: key.slice(0, API_KEY_PREFIX.length + 8),
    };
  }

  /**
   * Register the authenticated wallet as a merchant.
   *
   * `callerAddress` comes from the verified JWT, never from the request body.
   * Registration used to be an unauthenticated POST that accepted an arbitrary
   * `stellarAddress`, so anyone could squat any address — including one they
   * did not control — and receive a working API key for it.
   */
  async register(
    callerAddress: string,
    dto: RegisterMerchantDto,
  ): Promise<MerchantEntity & { apiKey: string }> {
    const existing = await this.repo.findOne({ where: { id: callerAddress } });
    if (existing) throw new ConflictException('Merchant already registered');

    const { key, hash, prefix } = this.generateApiKey();

    const merchant = await this.repo.save(
      this.repo.create({
        id: callerAddress,
        name: dto.name,
        treasuryWallet: dto.treasuryWallet,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        apiKeyRotatedAt: new Date(),
      }),
    );

    // The only time the plaintext key is ever available.
    return { ...merchant, apiKey: key };
  }

  async findById(id: string): Promise<MerchantEntity> {
    const merchant = await this.repo.findOne({ where: { id }, relations: ['plans'] });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant;
  }

  /** Load a merchant, asserting the caller owns it. */
  async findOwned(id: string, callerAddress: string): Promise<MerchantEntity> {
    if (id !== callerAddress) {
      // Deliberately 404 rather than 403 so the endpoint cannot be used to
      // confirm which addresses are registered merchants.
      throw new NotFoundException('Merchant not found');
    }
    return this.findById(id);
  }

  async update(
    id: string,
    callerAddress: string,
    dto: UpdateMerchantDto,
  ): Promise<MerchantEntity> {
    const merchant = await this.findOwned(id, callerAddress);

    if (dto.name !== undefined) merchant.name = dto.name;
    if (dto.treasuryWallet !== undefined) merchant.treasuryWallet = dto.treasuryWallet;
    if (dto.webhookUrl !== undefined) merchant.webhookUrl = dto.webhookUrl;
    if (dto.active !== undefined) merchant.active = dto.active;

    // `Object.assign(merchant, dto)` previously copied whatever the body
    // contained, so a request could set fields the DTO never intended to
    // expose. Assignments are explicit now.
    return this.repo.save(merchant);
  }

  async rotateApiKey(id: string, callerAddress: string): Promise<{ apiKey: string }> {
    await this.findOwned(id, callerAddress);
    const { key, hash, prefix } = this.generateApiKey();

    await this.repo.update(id, {
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      apiKeyRotatedAt: new Date(),
    });

    return { apiKey: key };
  }

  /** Resolve a merchant from a presented API key. Used by ApiKeyGuard. */
  async findByApiKey(key: string): Promise<MerchantEntity | null> {
    return this.repo.findOne({ where: { apiKeyHash: MerchantService.hashApiKey(key) } });
  }

  /** Rotate the webhook signing secret, returning it once. */
  async rotateWebhookSecret(id: string, callerAddress: string): Promise<{ webhookSecret: string }> {
    await this.findOwned(id, callerAddress);
    const secret = randomBytes(32).toString('hex');
    await this.repo.update(id, { webhookSecret: secret });
    return { webhookSecret: secret };
  }

  /** Load the webhook secret for signing. Never exposed through the API. */
  async getWebhookSecret(id: string): Promise<string | null> {
    const row = await this.repo
      .createQueryBuilder('m')
      .select('m.webhookSecret', 'secret')
      .where('m.id = :id', { id })
      .getRawOne<{ secret: string | null }>();
    return row?.secret ?? null;
  }

  /** Guard helper: assert the caller owns `merchantId`. */
  assertOwnership(merchantId: string, callerAddress: string): void {
    if (merchantId !== callerAddress) {
      throw new ForbiddenException('You do not own this merchant account');
    }
  }
}
