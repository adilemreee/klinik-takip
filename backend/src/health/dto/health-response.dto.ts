import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ example: 3600 })
  uptimeSeconds!: number;
}

export class ReadinessDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'error'] })
  status!: string;

  @ApiProperty({
    description: 'Per-dependency state: database, redis, storage',
    example: { database: { status: 'up', responseTimeMs: 2 } },
  })
  info!: Record<string, unknown>;

  @ApiProperty({ description: 'Dependencies reporting down' })
  error!: Record<string, unknown>;
}
