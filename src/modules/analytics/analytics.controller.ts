import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('merchants/:id/stats')
  stats(@Param('id') id: string) { return this.service.getMerchantStats(id); }

  @Get('merchants/:id/revenue')
  revenue(@Param('id') id: string, @Query('days') days = '30') {
    return this.service.getRevenueTimeline(id, parseInt(days, 10));
  }
}
