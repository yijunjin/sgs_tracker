import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common"
import type { ParsedLogEvent } from "@slt/shared"

import { SessionService } from "./session.service.js"

@Controller("sessions")
export class SessionController {
  constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

  @Post()
  createSession() {
    const session = this.sessionService.createSession()
    return {
      sessionId: session.id,
      state: session.state
    }
  }

  @Get(":id")
  getSession(@Param("id") id: string) {
    return this.sessionService.getSession(id).state
  }

  @Post(":id/events")
  applyEvent(@Param("id") id: string, @Body() event: ParsedLogEvent) {
    return this.sessionService.applyEvent(id, event)
  }

  @Post(":id/undo")
  undo(@Param("id") id: string) {
    return this.sessionService.undo(id)
  }

  @Post(":id/reset")
  reset(@Param("id") id: string) {
    return this.sessionService.reset(id)
  }
}
