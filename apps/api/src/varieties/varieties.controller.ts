import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { VarietiesService } from './varieties.service';
import { CreateVarietyDto } from './dto/create-variety.dto';
import { UpdateVarietyDto } from './dto/update-variety.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('varieties')
export class VarietiesController {
  constructor(private readonly varietiesService: VarietiesService) {}

  // 셀러 품종 선택 드롭다운 — 인증 불필요
  @Get()
  findAll(@Query('category') category?: string) {
    return this.varietiesService.findAll(category);
  }

  // 가드레일 단건 조회 — AI 충돌 검증에서도 사용
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.varietiesService.findOne(id);
  }

  // 신규 품종 등록 — 관리자만
  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateVarietyDto) {
    return this.varietiesService.create(dto);
  }

  // 품종 정보 수정 — 관리자만
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() dto: UpdateVarietyDto) {
    return this.varietiesService.update(id, dto);
  }
}
