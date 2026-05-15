import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlanController {
  constructor(private service: PlanService) {}

  @Post() create(@Body() dto: CreatePlanDto) { return this.service.create(dto); }
  @Get() findAll(@Query('merchantId') merchantId?: string) { return this.service.findAll(merchantId); }
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findById(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdatePlanDto) { return this.service.update(id, dto); }
  @Delete(':id') disable(@Param('id') id: string) { return this.service.disable(id); }
}
