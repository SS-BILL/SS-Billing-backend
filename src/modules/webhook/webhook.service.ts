import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, timingSafeEqual } from 'node:crypto';
import axios from 'axios';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { WebhookDeliveryEntity, WebhookStatus } from '../../db/entities/webhook-delivery.entity';
import { MerchantEntity } from '../../db/entities/merchant.entity';
import { WebhookTargetValidator } from './webhook-target.validator';

/** Cap on response body we will read back from a merchant endpoint. */
const MAX_RESPONSE_BYTES = 64 * 1024;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly validator: WebhookTargetValidator;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(
    @InjectRepository(WebhookDeliveryEntity)
    private readonly deliveryRepo: Repository<WebhookDeliveryEntity>,
    @InjectRepository(MerchantEntity)
    private readonly merchantRepo: Repository<MerchantEntity>,
    config: ConfigService,
  ) {
    const allowPrivate = config.get<boolean>('webhook.allowPrivateTargets') ?? false;
    this.validator = new WebhookTargetValidator(allowPrivate);
    this.timeoutMs = config.get<number>('webhook.timeoutMs') ?? 5000;
    this.maxAttempts = config.get<number>('webhook.maxAttempts') ?? 5;
  }

  async dispatch(merchantId: string, event: string, payload: Record<string, unknown>) {
    const merchant = await this.merchantRepo.findOne({ where: { id: merchantId } });
    if (!merchant?.webhookUrl) return;

    const check = this.validator.validateUrl(merchant.webhookUrl);
    if (!check.ok) {
      this.logger.warn(`Refusing webhook for merchant ${merchantId}: ${check.reason}`);
      return;
    }

    const delivery = await this.deliveryRepo.save(
      this.deliveryRepo.create({
        merchantId,
        event,
        payload,
        webhookUrl: merchant.webhookUrl,
      }),
    );

    await this.send(delivery, await this.loadSecret(merchantId));
  }

  /**
   * Signing secrets are `select: false`, so they must be requested explicitly.
   * This keeps them out of every incidental merchant read.
   */
  private async loadSecret(merchantId: string): Promise<string | null> {
    const row = await this.merchantRepo
      .createQueryBuilder('m')
      .select('m.webhookSecret', 'secret')
      .where('m.id = :id', { id: merchantId })
      .getRawOne<{ secret: string | null }>();
    return row?.secret ?? null;
  }

  private async send(delivery: WebhookDeliveryEntity, secret: string | null) {
    const attempts = delivery.attempts + 1;

    // Re-resolved on every attempt: a target that was public when the merchant
    // saved it may point somewhere else by the time we retry.
    const target = await this.validator.resolveAndCheck(delivery.webhookUrl);
    if (!target.ok) {
      this.logger.warn(`Blocked webhook delivery ${delivery.id}: ${target.reason}`);
      await this.deliveryRepo.update(delivery.id, {
        status: WebhookStatus.FAILED,
        attempts,
        errorMessage: `blocked: ${target.reason}`,
        nextRetryAt: null,
      });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      timestamp,
      data: delivery.payload,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'SS-Billing-Webhooks/1',
      'X-Webhook-Id': delivery.id,
      'X-Webhook-Timestamp': String(timestamp),
    };

    if (secret) {
      // The timestamp is inside the signed payload, so a captured delivery
      // cannot be replayed later. The previous signature covered the body
      // alone and had no expiry.
      headers['X-Webhook-Signature'] = `t=${timestamp},v1=${this.sign(secret, timestamp, body)}`;
    }

    try {
      const res = await axios.post(delivery.webhookUrl, body, {
        headers,
        timeout: this.timeoutMs,
        // Redirects are the standard SSRF bypass: a public URL that 302s to
        // 169.254.169.254 defeats any pre-flight host check.
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        // Any status is "delivered as far as the network goes"; success is
        // decided below so a 500 is retried and a 410 is not.
        validateStatus: () => true,
        httpAgent: new HttpAgent({ keepAlive: false }),
        httpsAgent: new HttpsAgent({ keepAlive: false }),
      });

      const delivered = res.status >= 200 && res.status < 300;
      if (delivered) {
        await this.deliveryRepo.update(delivery.id, {
          status: WebhookStatus.DELIVERED,
          responseCode: res.status,
          attempts,
          nextRetryAt: null,
          errorMessage: null,
        });
        return;
      }

      // 4xx other than 408/429 will not succeed on retry.
      const permanent = res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status);
      await this.recordFailure(delivery, attempts, `HTTP ${res.status}`, permanent, res.status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown transport error';
      await this.recordFailure(delivery, attempts, message, false);
    }
  }

  private async recordFailure(
    delivery: WebhookDeliveryEntity,
    attempts: number,
    errorMessage: string,
    permanent: boolean,
    responseCode?: number,
  ) {
    const exhausted = permanent || attempts >= this.maxAttempts;

    // Exponential backoff with a cap, rather than the previous linear
    // `attempts * 60s`, so a persistently failing endpoint is not hammered.
    const backoffMs = Math.min(2 ** attempts * 30_000, 6 * 60 * 60 * 1000);

    await this.deliveryRepo.update(delivery.id, {
      status: exhausted ? WebhookStatus.FAILED : WebhookStatus.PENDING,
      attempts,
      responseCode: responseCode ?? null,
      errorMessage: errorMessage.slice(0, 500),
      nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs),
    });

    this.logger.warn(
      `Webhook ${delivery.id} attempt ${attempts}/${this.maxAttempts} failed: ${errorMessage}`,
    );
  }

  private sign(secret: string, timestamp: number, body: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  /**
   * Verify an inbound signature. Exposed so merchants can copy the exact
   * comparison, and used by the service's own tests.
   */
  static verifySignature(
    secret: string,
    header: string,
    body: string,
    toleranceSec = 300,
  ): boolean {
    const parts = Object.fromEntries(
      header.split(',').map((kv) => kv.split('=', 2) as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) return false;

    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
    const provided = Buffer.from(parts.v1 ?? '', 'hex');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryFailed() {
    const pending = await this.deliveryRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: WebhookStatus.PENDING })
      .andWhere('d.next_retry_at IS NOT NULL')
      .andWhere('d.next_retry_at <= NOW()')
      .andWhere('d.attempts < :max', { max: this.maxAttempts })
      .orderBy('d.next_retry_at', 'ASC')
      .limit(50)
      .getMany();

    // The previous implementation issued one merchant query per delivery
    // inside the loop. Secrets are fetched once per distinct merchant instead.
    const secrets = new Map<string, string | null>();
    for (const delivery of pending) {
      if (!secrets.has(delivery.merchantId)) {
        secrets.set(delivery.merchantId, await this.loadSecret(delivery.merchantId));
      }
      await this.send(delivery, secrets.get(delivery.merchantId) ?? null);
    }
  }
}
