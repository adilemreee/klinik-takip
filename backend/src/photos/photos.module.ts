import { Module } from '@nestjs/common';
import { PatientPhotosController, PhotosController } from './photos.controller';
import { AIModule } from '../ai/ai.module';
import { PhotoAssessmentService } from './assessment.service';
import { PhotosService } from './photos.service';

@Module({
  imports: [AIModule],
  controllers: [PatientPhotosController, PhotosController],
  providers: [PhotosService, PhotoAssessmentService],
  exports: [PhotosService],
})
export class PhotosModule {}
