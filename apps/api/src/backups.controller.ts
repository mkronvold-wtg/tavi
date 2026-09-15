import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  applyBackupRestoreSchema,
  previewBackupRestoreSchema,
  updateBackupSettingsSchema,
  updateBackupProtectionSchema,
  uploadBackupFileSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { BackupsService } from './backups.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('backups')
@UseGuards(SessionGuard)
export class BackupsController {
  constructor(
    private readonly authService: AuthService,
    private readonly backupsService: BackupsService,
  ) {}

  @Get()
  getBackupStatus(@Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);
    return this.backupsService.getBackupStatus();
  }

  @Put()
  updateBackupSettings(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireAdminAccess(request.user!);
    const input = parseInput(updateBackupSettingsSchema, body);
    return this.backupsService.updateBackupSettings(request.user!, input);
  }

  @Post('create')
  createBackup(@Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);
    return this.backupsService.createBackupNow(request.user!);
  }

  @Post('upload')
  uploadBackup(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);
    const input = parseInput(uploadBackupFileSchema, body);
    return this.backupsService.uploadBackupFile(request.user!, input);
  }

  @Get(':fileName/download')
  async downloadBackup(
    @Param('fileName') fileName: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireAdminAccess(request.user!);
    const backup = await this.backupsService.downloadBackupFile(fileName);
    return new StreamableFile(Buffer.from(backup.content, 'utf8'), {
      disposition: `attachment; filename="${backup.fileName}"`,
      type: 'application/json; charset=utf-8',
    });
  }

  @Delete(':fileName')
  deleteBackup(
    @Param('fileName') fileName: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireAdminAccess(request.user!);
    return this.backupsService.deleteBackupFile(request.user!, fileName);
  }

  @Patch(':fileName/protection')
  updateBackupProtection(
    @Param('fileName') fileName: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireAdminAccess(request.user!);
    const input = parseInput(updateBackupProtectionSchema, body);
    return this.backupsService.updateBackupProtection(
      request.user!,
      fileName,
      input,
    );
  }

  @Post('restore/preview')
  previewRestore(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);
    const input = parseInput(previewBackupRestoreSchema, body);
    return this.backupsService.previewRestore(input);
  }

  @Post('restore/apply')
  applyRestore(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);
    const input = parseInput(applyBackupRestoreSchema, body);
    return this.backupsService.applyRestore(request.user!, input);
  }
}
