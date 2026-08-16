import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../../modules/auth/auth.service';

export interface AuthenticatedUser {
  /** Stellar address proven by wallet signature. */
  address: string;
  /** Merchant id, present only when this address owns a merchant account. */
  merchantId?: string;
}

/**
 * The principal established by JwtAuthGuard.
 *
 * Controllers must scope every query by this rather than trusting a path or
 * query parameter — previously `payload.merchantId` was parsed in the JWT
 * strategy and then never consulted anywhere, so any valid token could read
 * and mutate any merchant's data.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);

export type { JwtPayload };
