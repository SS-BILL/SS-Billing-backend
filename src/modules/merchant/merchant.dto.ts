import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class RegisterMerchantDto {
  @IsString() name: string;
  @IsString() stellarAddress: string;
  @IsString() treasuryWallet: string;
}

export class UpdateMerchantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() treasuryWallet?: string;
  @IsOptional() @IsUrl() webhookUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
