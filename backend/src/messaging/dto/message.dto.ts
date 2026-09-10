import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageStatus, MessageType, TriageLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ description: 'Key returned by the attachment upload' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  mediaKey?: string;
}

export class MessagePageQueryDto {
  @ApiPropertyOptional({ description: 'Id of the oldest message already shown' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null for clinic or system messages' })
  senderId!: string | null;

  @ApiProperty({ enum: MessageType })
  type!: MessageType;

  @ApiProperty({ nullable: true })
  body!: string | null;

  @ApiProperty({ nullable: true, description: 'Set once the AI layer transcribes audio (Faz 5)' })
  transcript!: string | null;

  @ApiProperty({ enum: MessageStatus })
  status!: MessageStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When a held message will be delivered',
  })
  queuedUntil!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiPropertyOptional({
    enum: TriageLevel,
    nullable: true,
    description: 'What the clinic acted on: the higher of the keyword screen and the AI reading',
  })
  triageLevel!: TriageLevel | null;

  @ApiProperty({
    type: [String],
    description: 'Ids of the red flags that fired, never the phrases they matched',
  })
  triageFlags!: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: "The AI's own reading. Advisory: it can raise triageLevel, never lower it",
    enum: TriageLevel,
  })
  aiTriageLevel!: TriageLevel | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Three lines for the clinician (complaint / measurements / duration). Shown beside the message, never instead of it',
  })
  aiSummary!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The language the sender wrote in, as the model read it (BCP-47)',
  })
  originalLanguage!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A translation somebody asked for. Shown beside the original, never instead of it',
  })
  translatedText!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Which language it was translated into' })
  translatedTo!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class MessagePageDto {
  @ApiProperty({ type: [MessageDto], description: 'Oldest first, ready to render' })
  items!: MessageDto[];

  @ApiProperty({ nullable: true, description: 'Pass back to load older messages' })
  nextCursor!: string | null;
}

export class SentMessageDto {
  @ApiProperty({ type: MessageDto })
  message!: MessageDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set when the message was held until the clinic opens',
  })
  queuedUntil!: Date | null;
}

export class ClinicStateDto {
  @ApiProperty({ description: 'Whether the clinic is reachable now' })
  open!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  opensAt!: Date | null;
}

export class AttachmentDto {
  @ApiProperty({ description: 'Send this with the message' })
  mediaKey!: string;

  @ApiProperty({ description: 'Detected from the bytes, not from what was declared' })
  mime!: string;

  @ApiProperty()
  size!: number;
}

export class AttachmentUrlDto {
  @ApiProperty()
  url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}

export class ConversationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ nullable: true })
  subject!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastMessageAt!: Date | null;
}

export class QuickReplyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, description: 'Null for a reply the whole clinic shares' })
  staffId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ description: "The clinic's order, not alphabetical" })
  sortOrder!: number;
}

export class CreateQuickReplyDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}


/** Who a conversation is with, on a list that crosses patients. */
export class InboxPatientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-K7RMPX' })
  mrn!: string;

  @ApiProperty({ example: 'Ayşe Yılmaz' })
  fullName!: string;
}

export class InboxLastMessageDto {
  @ApiPropertyOptional({ nullable: true, description: 'Null for an attachment with no text' })
  body!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  sentAt!: Date;

  @ApiProperty({ enum: MessageType })
  type!: MessageType;
}

export class InboxEntryDto {
  @ApiProperty({ type: ConversationDto })
  conversation!: ConversationDto;

  @ApiProperty({ type: InboxPatientDto })
  patient!: InboxPatientDto;

  @ApiPropertyOptional({ type: InboxLastMessageDto, nullable: true })
  lastMessage!: InboxLastMessageDto | null;

  @ApiProperty({ description: 'Approximate: enough to decide whether to open the row' })
  unread!: number;
}

/**
 * Which language to translate a message into.
 *
 * The reader's, not the clinic's: a German patient reading a Turkish reply and
 * a Turkish clinician reading a German complaint want the same button to do
 * two different things.
 */
export class TranslateMessageDto {
  @ApiProperty({ example: 'tr', description: 'BCP-47 language tag' })
  @Matches(/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/, { message: 'to must be a language tag like "tr"' })
  to!: string;
}
