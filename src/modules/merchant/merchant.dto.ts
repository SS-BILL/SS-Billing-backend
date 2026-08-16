import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

export class RegisterMerchantDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  name: string;

  @ApiProperty({ description: 'Stellar address that receives collected funds' })
  @IsString()
  @Matches(STELLAR_ADDRESS, { message: 'treasuryWallet must be a Stellar public key (G...)' })
  treasuryWallet: string;
}

export class UpdateMerchantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(STELLAR_ADDRESS, { message: 'treasuryWallet must be a Stellar public key (G...)' })
  treasuryWallet?: string;

  /**
   * Validated for shape here and for network target at delivery time — see
   * WebhookService, which refuses to resolve private address ranges.
   */
  @ApiPropertyOptional({ description: 'HTTPS endpoint for event delivery' })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
