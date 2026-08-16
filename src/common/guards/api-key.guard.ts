import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { MerchantService } from '../../modules/merchant/merchant.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Server-to-server authentication for merchant integrations.
 *
 * Keys are compared by SHA-256 digest against `api_key_hash`; the plaintext is
 * never stored and never leaves the response that issued it. The previous
 * implementation looked the raw key up directly in a plaintext column.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly merchants: MerchantService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();

    const header = req.headers['x-api-key'];
    // A repeated header arrives as an array; picking [0] silently would let a
    // client smuggle a second value past any logging.
    const key = typeof header === 'string' ? header : undefined;

    if (!key) throw new UnauthorizedException('API key required');

    const merchant = await this.merchants.findByApiKey(key);
    if (!merchant || !merchant.active) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Present the same principal shape as JwtAuthGuard so controllers can use
    // @CurrentUser regardless of which credential was presented.
    req.user = { address: merchant.id, merchantId: merchant.id };
    return true;
  }
}
