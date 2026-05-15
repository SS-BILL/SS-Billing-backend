import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './subscription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private service: SubscriptionService) {}

  @Post() create(@Body() dto: CreateSubscriptionDto) { return this.service.create(dto); }
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findById(id); }
  @Get() findBySubscriber(@Query('address') address: string) { return this.service.findBySubscriber(address); }
  @Patch(':id/pause') pause(@Param('id') id: string) { return this.service.pause(id); }
  @Patch(':id/resume') resume(@Param('id') id: string) { return this.service.resume(id); }
  @Delete(':id') cancel(@Param('id') id: string) { return this.service.cancel(id); }
  @Get(':id/payments') payments(@Param('id') id: string) { return this.service.getPaymentHistory(id); }
}
