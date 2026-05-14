import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"

import { SessionService } from "./session.service.js"

@Injectable()
export class AliasMiningScheduler {
  private readonly logger = new Logger(AliasMiningScheduler.name)
  private running = false

  constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

  @Cron("*/30 * * * * *")
  async handleEndedSessions(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    try {
      for (const session of this.sessionService.listEndedPendingSessions()) {
        try {
          await this.sessionService.exportAndAnalyze(session)
        } catch (error) {
          session.exportStatus = "failed"
          session.lastError = error instanceof Error ? error.message : "定时别名分析失败"
          this.logger.error(`Failed to export/analyze ${session.id}: ${session.lastError}`)
        }
      }
    } finally {
      this.running = false
    }
  }
}
