import { Body, Controller, Get, Header, Inject, Param, Post } from "@nestjs/common"
import type { OcrLine, OcrLogRecord, ParsedLogEvent, UserCorrectionRecord } from "@slt/shared"

import { SessionService } from "./session.service.js"

@Controller("sessions")
export class SessionController {
  constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

  @Post()
  createSession(@Body() body?: { endActive?: boolean }) {
    const session = this.sessionService.createSession({ endActive: Boolean(body?.endActive) })
    return {
      sessionId: session.id,
      state: session.state
    }
  }

  @Get(":id")
  getSession(@Param("id") id: string) {
    return this.sessionService.getSession(id).state
  }

  @Get()
  listSessions() {
    return this.sessionService.listSessionSummaries()
  }

  @Post(":id/events")
  applyEvent(@Param("id") id: string, @Body() event: ParsedLogEvent) {
    return this.sessionService.applyEvent(id, event)
  }

  @Post(":id/ocr-batch")
  recordOcrBatch(
    @Param("id") id: string,
    @Body()
    body: {
      rawLines?: OcrLine[] | string[]
      mergedLines?: OcrLine[] | string[]
      source?: OcrLogRecord["source"]
      ocrEngine?: string
    }
  ) {
    const session = this.sessionService.recordOcrBatch(id, body)
    return {
      ok: true,
      rawLineCount: session.rawOcrLines.length,
      mergedLineCount: session.mergedLines.length
    }
  }

  @Post(":id/corrections")
  recordCorrection(
    @Param("id") id: string,
    @Body()
    body: {
      eventId: string
      correctedCardName?: string
      reason?: UserCorrectionRecord["reason"]
    }
  ) {
    return this.sessionService.recordCorrection(id, body)
  }

  @Post(":id/end")
  endSession(@Param("id") id: string) {
    return this.sessionService.endSession(id)
  }

  @Post("cleanup-empty")
  cleanupEmptySessions() {
    return this.sessionService.cleanupEmptySessions()
  }

  @Get(":id/export/text")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Content-Disposition", "attachment")
  exportText(@Param("id") id: string) {
    return this.sessionService.readTextReport(id)
  }

  @Get(":id/export/json")
  exportJson(@Param("id") id: string) {
    return this.sessionService.readJsonReport(id)
  }

  @Post(":id/analyze-aliases")
  analyzeAliases(@Param("id") id: string) {
    return this.sessionService.analyzeAliases(id)
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
