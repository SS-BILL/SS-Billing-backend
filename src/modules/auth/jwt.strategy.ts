import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // `getOrThrow` rather than `get(..)!`: a missing secret must not be
      // coerced into `undefined` and silently disable verification.
      secretOrKey: config.getOrThrow<string>('app.jwtSecret'),
      issuer: 'ss-billing',
      audience: 'ss-billing-api',
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    return {
      address: payload.sub,
      ...(payload.merchantId ? { merchantId: payload.merchantId } : {}),
    };
  }
}
