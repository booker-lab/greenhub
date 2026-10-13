import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ListOperationIssuesQueryDto } from './dto/list-operation-issues.dto';
import { OperationActionDto } from './dto/operation-action.dto';
import { ResolveOperationIssueDto } from './dto/resolve-operation-issue.dto';
import { OperationsService } from './operations.service';

@Controller('stores/:storeId/operation-issues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListOperationIssuesQueryDto = {},
  ) {
    return this.operations.listIssuesForStore(storeId, user.sub, user.role, query);
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

  /** 자동으로 닫히지 않는 기록을 메모와 함께 해결로 닫는다. 이미 닫힌 기록은 그대로 돌려준다. */
  @Post(':issueId/resolve')
  @HttpCode(200)
  resolve(
    @Param('storeId') storeId: string,
    @Param('issueId') issueId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ResolveOperationIssueDto,
  ) {
    return this.operations.resolveIssueForStore(storeId, issueId, user.sub, user.role, dto.memo);
  }
}
