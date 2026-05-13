import { Module } from "@nestjs/common"

import { DeckController } from "./deck.controller.js"
import { HealthController } from "./health.controller.js"
import { SessionController } from "./session.controller.js"
import { SessionService } from "./session.service.js"

@Module({
  controllers: [HealthController, DeckController, SessionController],
  providers: [SessionService]
})
export class AppModule {}
