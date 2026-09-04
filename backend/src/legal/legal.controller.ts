import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, Header, Logger, NotFoundException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';

export class LegalDocumentDto {
  @ApiProperty({ example: 'privacy-notice' })
  id!: string;

  @ApiProperty({
    example: 1,
    description: 'Which wording this is. A consent records the version it agreed to.',
  })
  version!: number;

  @ApiProperty({ description: 'Markdown' })
  body!: string;
}

/**
 * The legal texts, served rather than compiled into the clients (KVKK m.10).
 *
 * Two reasons, and the second is the one that matters. A notice that needs an
 * App Store release to correct stays wrong for a fortnight — and the whole
 * point of an aydınlatma metni is that it is accurate at the moment somebody
 * reads it. Serving it also gives the version a consent record can name: "they
 * agreed" means nothing without saying to what.
 *
 * Public on purpose. A privacy notice that can only be read after signing in is
 * one somebody cannot read before deciding whether to sign up.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  private readonly logger = new Logger(LegalController.name);

  /**
   * The current wording's version.
   *
   * Bumped by hand when the text changes materially, because "materially" is a
   * judgement a file's modification time cannot make. A bump means consents
   * given against the old wording are visibly against the old wording.
   */
  private static readonly PRIVACY_NOTICE_VERSION = 1;

  @Get('privacy-notice')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'The privacy notice, as Markdown' })
  @ApiOkResponse({ type: LegalDocumentDto })
  @ApiStandardErrors()
  async privacyNotice(): Promise<LegalDocumentDto> {
    return {
      id: 'privacy-notice',
      version: LegalController.PRIVACY_NOTICE_VERSION,
      body: await this.read('KVKK-AYDINLATMA-METNI.md'),
    };
  }

  /**
   * Read from the repository's own document rather than a second copy.
   *
   * A privacy notice that exists twice is one that will disagree with itself,
   * and the disagreement will be discovered by whoever is holding the wrong
   * half.
   */
  private async read(name: string): Promise<string> {
    // dist/legal → dist → backend/legal, which sync-legal.ts fills from
    // docs/. Copied rather than read from docs/ directly because the Docker
    // build context is backend/, and docs/ is not inside it.
    const path = join(__dirname, '..', '..', 'legal', name);

    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      this.logger.error(`Legal document unavailable at ${path}: ${String(error)}`);

      // Not an empty string: a notice that renders blank looks like a clinic
      // with nothing to declare rather than a deployment that lost a file.
      throw new NotFoundException('Legal document not available');
    }
  }
}
