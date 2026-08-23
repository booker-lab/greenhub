import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OperationActionDto } from './dto/operation-action.dto';
import { OperationsService } from './operations.service';

@Controller('stores/:storeId/operation-issues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.operations.listIssuesForStore(storeId, user.sub, user.role);
  }

  @Get(':issueId')
  get(
    @Param('storeId') storeId: string,
    @Param('issueId') issueId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.getIssueForStore(storeId, issueId, user.sub, user.role);
  }

  @Post(':issueId/refresh')
  refresh(
    @Param('storeId') storeId: string,
    @Param('issueId') issueId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.operations.refreshIssueForStore(storeId, issueId, user.sub, user.role);
  }

  @Post(':issueId/actions')
  execute(
    @Param('storeId') storeId: string,
    @Param('issueId') issueId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: OperationActionDto,
  ) {
    return this.operations.executeActionForStore(
      storeId,
      issueId,
      user.sub,
      user.role,
      dto.actionType,
    );
  }
}
