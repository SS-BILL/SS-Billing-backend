import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantService } from './merchant.service';
import { RegisterMerchantDto, UpdateMerchantDto } from './merchant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Every route here is authenticated and scoped to the caller's own address.
 *
 * Previously `POST /merchants` and `GET /merchants/:id` were both
 * unauthenticated, and the GET returned the full entity — including the
 * plaintext API key and webhook secret — for any merchant id supplied.
 */
@ApiTags('merchants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('merchants')
export class MerchantController {
  constructor(private readonly service: MerchantService) {}

  @Post()
  @ApiOperation({ summary: 'Register the authenticated wallet as a merchant' })
  register(@CurrentUser('address') address: string, @Body() dto: RegisterMerchantDto) {
    return this.service.register(address, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Fetch the authenticated merchant account' })
  findMe(@CurrentUser('address') address: string) {
    return this.service.findById(address);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('address') address: string) {
    return this.service.findOwned(id, address);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser('address') address: string,
    @Body() dto: UpdateMerchantDto,
  ) {
    return this.service.update(id, address, dto);
  }

  @Post(':id/rotate-key')
  @ApiOperation({ summary: 'Issue a new API key; the plaintext is returned once' })
  rotateKey(@Param('id') id: string, @CurrentUser('address') address: string) {
    return this.service.rotateApiKey(id, address);
  }

  @Post(':id/rotate-webhook-secret')
  @ApiOperation({ summary: 'Issue a new webhook signing secret; returned once' })
  rotateWebhookSecret(@Param('id') id: string, @CurrentUser('address') address: string) {
    return this.service.rotateWebhookSecret(id, address);
  }
}
