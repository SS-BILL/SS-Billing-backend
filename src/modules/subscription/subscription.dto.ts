import { IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString() subscriberAddress: string;
  @IsString() planId: string;
}
