import { Module } from '@nestjs/common';
import { PatientPhotosController, PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  controllers: [PatientPhotosController, PhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
