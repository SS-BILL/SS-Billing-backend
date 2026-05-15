import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { MerchantEntity } from '../../db/entities/merchant.entity';
import { RegisterMerchantDto, UpdateMerchantDto } from './merchant.dto';

@Injectable()
export class MerchantService {
  constructor(
    @InjectRepository(MerchantEntity)
    private repo: Repository<MerchantEntity>,
  ) {}

  async register(dto: RegisterMerchantDto): Promise<MerchantEntity> {
    const existing = await this.repo.findOne({ where: { id: dto.stellarAddress } });
    if (existing) throw new ConflictException('Merchant already registered');

    const merchant = this.repo.create({
      id: dto.stellarAddress,
      name: dto.name,
      treasuryWallet: dto.treasuryWallet,
      apiKey: randomBytes(32).toString('hex'),
    });
    return this.repo.save(merchant);
  }

  async findById(id: string): Promise<MerchantEntity> {
    const merchant = await this.repo.findOne({ where: { id }, relations: ['plans'] });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant;
  }

  async update(id: string, dto: UpdateMerchantDto): Promise<MerchantEntity> {
    const merchant = await this.findById(id);
    Object.assign(merchant, dto);
    return this.repo.save(merchant);
  }

  async rotateApiKey(id: string): Promise<{ apiKey: string }> {
    const merchant = await this.findById(id);
    merchant.apiKey = randomBytes(32).toString('hex');
    await this.repo.save(merchant);
    return { apiKey: merchant.apiKey };
  }
}
