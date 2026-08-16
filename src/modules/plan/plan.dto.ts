import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

/** Stroops-style integer amounts are carried as strings to avoid float loss. */
const POSITIVE_INTEGER_STRING = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER_STRING = /^\d+$/;
const STELLAR_CONTRACT = /^C[A-Z2-7]{55}$/;

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  name: string;

  @ApiProperty({ description: 'Amount per cycle, integer string in token base units' })
  @IsString()
  @Matches(POSITIVE_INTEGER_STRING, { message: 'amount must be a positive integer string' })
  amount: string;

  @ApiProperty({ description: 'Token contract address (C...)' })
  @IsString()
  @Matches(STELLAR_CONTRACT, { message: 'token must be a Stellar contract address (C...)' })
  token: string;

  @ApiProperty({ description: 'Seconds between billing cycles' })
  @IsString()
  @Matches(POSITIVE_INTEGER_STRING, { message: 'interval must be a positive integer string' })
  interval: string;

  @ApiPropertyOptional({ description: 'Seconds after the due date before failing' })
  @IsOptional()
  @IsString()
  @Matches(NON_NEGATIVE_INTEGER_STRING)
  gracePeriod?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  retryLimit?: number;

  @ApiPropertyOptional({ description: 'Seconds between retry attempts' })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_INTEGER_STRING)
  retryInterval?: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 64) name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_INTEGER_STRING)
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_INTEGER_STRING)
  interval?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(NON_NEGATIVE_INTEGER_STRING)
  gracePeriod?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) retryLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_INTEGER_STRING)
  retryInterval?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
