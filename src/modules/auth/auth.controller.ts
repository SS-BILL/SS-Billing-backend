import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChallengeRequestDto,
  ChallengeResponseDto,
  VerifyRequestDto,
  VerifyResponseDto,
} from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  // Challenge creation writes a row per call, so it is rate limited harder
  // than a plain read would be.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a nonce to sign with a Stellar wallet' })
  challenge(@Body() dto: ChallengeRequestDto): Promise<ChallengeResponseDto> {
    return this.auth.createChallenge(dto.address);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  // Brute-forcing an ed25519 signature is infeasible; the limit exists to cap
  // the cost of the verification work itself.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a signed challenge for an access token' })
  verify(@Body() dto: VerifyRequestDto): Promise<VerifyResponseDto> {
    return this.auth.verifyChallenge(dto.address, dto.message, dto.signature);
  }
}
