import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  /**
   * `subscriberAddress` is deliberately absent: it is taken from the verified
   * JWT. Accepting it in the body let any caller create a subscription in
   * someone else's name.
   */
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsUUID()
  planId: string;
}
