import { Module } from '@nestjs/common';
import {
  MyPhotosController,
  PatientPhotosController,
  PhotosController,
} from './photos.controller';
import { MeasurementsModule } from '../measurements/measurements.module';
import { AIModule } from '../ai/ai.module';
import { PhotoAssessmentService } from './assessment.service';
import { PhotosService } from './photos.service';

@Module({
  imports: [AIModule, MeasurementsModule],
  controllers: [MyPhotosController, PatientPhotosController, PhotosController],
  providers: [PhotosService, PhotoAssessmentService],
  exports: [PhotosService],
})
export class PhotosModule {}
