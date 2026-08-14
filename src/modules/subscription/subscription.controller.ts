import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './subscription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Post()
  create(@CurrentUser('address') address: string, @Body() dto: CreateSubscriptionDto) {
    return this.service.create(address, dto);
  }

  /**
   * The `?address=` query parameter is gone. It was unauthenticated in effect:
   * any token could list any wallet's subscriptions by passing its address.
   */
  @Get()
  @ApiOperation({ summary: "List the caller's own subscriptions" })
  findMine(@CurrentUser('address') address: string) {
    return this.service.findMine(address);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('address') address: string,
  ) {
    return this.service.findForParticipant(id, address);
  }

  @Patch(':id/pause')
  pause(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('address') address: string) {
    return this.service.pause(id, address);
  }

  @Patch(':id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('address') address: string) {
    return this.service.resume(id, address);
  }

  @Delete(':id')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('address') address: string) {
    return this.service.cancel(id, address);
  }

  @Get(':id/payments')
  payments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('address') address: string) {
    return this.service.getPaymentHistory(id, address);
  }
}
