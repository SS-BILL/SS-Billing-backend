import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsString, Length, Matches, MaxLength } from 'class-validator';

/** Stellar ed25519 public key: 56 chars, base32, leading G. */
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

export class ChallengeRequestDto {
  @ApiProperty({ example: 'GKEEPER...', description: 'Stellar address to authenticate' })
  @IsString()
  @Matches(STELLAR_ADDRESS, { message: 'address must be a Stellar public key (G...)' })
  address: string;
}

export class ChallengeResponseDto {
  @ApiProperty({ description: 'Exact text the wallet must sign' })
  message: string;

  @ApiProperty() expiresAt: Date;
}

export class VerifyRequestDto {
  @ApiProperty()
  @IsString()
  @Matches(STELLAR_ADDRESS, { message: 'address must be a Stellar public key (G...)' })
  address: string;

  @ApiProperty({ description: 'The challenge message, returned verbatim' })
  @IsString()
  @MaxLength(1024)
  message: string;

  @ApiProperty({ description: 'base64 ed25519 signature over the message' })
  @IsString()
  @IsBase64()
  @Length(1, 512)
  signature: string;
}

export class VerifyResponseDto {
  @ApiProperty() accessToken: string;

  @ApiProperty({ nullable: true, description: 'Present when this address owns a merchant' })
  merchantId: string | null;
}
