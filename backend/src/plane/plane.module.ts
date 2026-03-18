import { Module } from '@nestjs/common';
import { PlaneService } from './plane.service';

@Module({
  providers: [PlaneService],
  exports: [PlaneService],
})
export class PlaneModule {}
