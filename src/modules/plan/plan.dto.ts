import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() merchantId: string;
  @IsString() name: string;
  @IsString() amount: string;
  @IsString() token: string;
  @IsString() interval: string; // seconds as string
  @IsOptional() @IsString() gracePeriod?: string;
  @IsOptional() @IsNumber() @Min(1) retryLimit?: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() amount?: string;
  @IsOptional() @IsString() interval?: string;
  @IsOptional() @IsString() gracePeriod?: string;
  @IsOptional() @IsNumber() retryLimit?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
