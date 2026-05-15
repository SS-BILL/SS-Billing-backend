import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MerchantService } from './merchant.service';
import { RegisterMerchantDto, UpdateMerchantDto } from './merchant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantController {
  constructor(private service: MerchantService) {}

  @Post()
  register(@Body() dto: RegisterMerchantDto) {
    return this.service.register(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() dto: UpdateMerchantDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/rotate-key')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  rotateKey(@Param('id') id: string) {
    return this.service.rotateApiKey(id);
  }
}
