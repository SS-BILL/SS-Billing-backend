import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Analytics are always the caller's own.
 *
 * The merchant id used to come from the path, unchecked, so any authenticated
 * token could read any merchant's revenue, MRR and churn.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('stats')
  @ApiOperation({ summary: "Subscription counts and MRR for the caller's merchant" })
  stats(@CurrentUser('address') address: string) {
    return this.service.getMerchantStats(address);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Daily revenue timeline for the calling merchant' })
  revenue(
    @CurrentUser('address') address: string,
    // Bounded: an unvalidated `days` fed straight into the query planner.
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.service.getRevenueTimeline(address, Math.min(Math.max(days, 1), 365));
  }
}
