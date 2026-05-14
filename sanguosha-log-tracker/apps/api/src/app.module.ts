import { Module } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"

import { AliasController } from "./alias.controller.js"
import { AliasMiningScheduler } from "./alias-mining.scheduler.js"
import { AliasService } from "./alias.service.js"
import { DeckController } from "./deck.controller.js"
import { HealthController } from "./health.controller.js"
import { SessionController } from "./session.controller.js"
import { SessionService } from "./session.service.js"

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [HealthController, DeckController, SessionController, AliasController],
  providers: [SessionService, AliasService, AliasMiningScheduler]
})
export class AppModule {}
