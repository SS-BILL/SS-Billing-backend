import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchantEntity } from '../../db/entities/merchant.entity';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(MerchantEntity)
    private merchants: Repository<MerchantEntity>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key) throw new UnauthorizedException('API key required');
    const merchant = await this.merchants.findOne({ where: { apiKey: key } });
    if (!merchant) throw new UnauthorizedException('Invalid API key');
    req.merchant = merchant;
    return true;
  }
}
