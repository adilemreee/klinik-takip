import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AskDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @Length(3, 4_000)
  question!: string;
}

export class AssistantResultDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The stored question — the handle for "this answer is not enough"',
  })
  questionMessageId!: string;

  @ApiProperty()
  answered!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Null when a person is answering instead' })
  answer!: string | null;

  @ApiProperty({ type: [String], description: 'Clinic documents the answer came from' })
  sources!: string[];

  @ApiPropertyOptional({
    nullable: true,
    enum: ['no-sources', 'model-declined', 'no-citations', 'ai-unavailable'],
    description: 'Why the question went to a person',
  })
  handoverReason!: string | null;
}
