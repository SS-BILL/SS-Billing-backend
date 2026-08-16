import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlanController {
  constructor(private readonly service: PlanService) {}

  @Post()
  create(@CurrentUser('address') address: string, @Body() dto: CreatePlanDto) {
    return this.service.create(address, dto);
  }

  /**
   * Lists the caller's own plans. The `merchantId` query parameter is gone —
   * it was unvalidated, so any token could enumerate any merchant's catalogue,
   * and omitting it returned every plan in the system.
   */
  @Get()
  @ApiOperation({ summary: "List the authenticated merchant's plans" })
  findAll(@CurrentUser('address') address: string) {
    return this.service.findAllForMerchant(address);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Plan detail, readable by any authenticated user' })
  findOne(@Param('id') id: string) {
    return this.service.findPublic(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser('address') address: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.service.update(id, address, dto);
  }

  @Delete(':id')
  disable(@Param('id') id: string, @CurrentUser('address') address: string) {
    return this.service.disable(id, address);
  }
}
