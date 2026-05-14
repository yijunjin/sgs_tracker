import { Inject, Injectable, NotFoundException } from "@nestjs/common"
import {
  applyEvent,
  createInitialTrackerState,
  demoDeckProfile,
  undoLastEvent,
  type OcrLine,
  type OcrLogRecord,
  type ParsedLogEvent,
  type SessionExportStatus,
  type SessionReport,
  type TrackerState,
  type UserCorrectionRecord
} from "@slt/shared"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"

import { AliasService } from "./alias.service.js"

export type SessionStatus = "active" | "ended" | "exported" | "aliasAnalyzed" | "archived"

export interface SessionRecord {
  id: string
  state: TrackerState
  status: SessionStatus
  exportStatus: SessionExportStatus
  startedAt: number
  endedAt?: number | undefined
  ocrEngine: string
  aliasDictionaryVersion?: string | undefined
  rawOcrLines: OcrLogRecord[]
  mergedLines: OcrLogRecord[]
  userCorrections: UserCorrectionRecord[]
  lastError?: string | undefined
}

function dataRoot(): string {
  const cwd = process.cwd()
  return basename(cwd) === "api" ? resolve(cwd, "data") : resolve(cwd, "apps/api/data")
}

function createRecordId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toLogRecord(line: OcrLine | string, source: OcrLogRecord["source"], index: number): OcrLogRecord {
  const isText = typeof line === "string"
  return {
    id: `${createRecordId("ocr-line")}-${index}`,
    text: isText ? line : line.text,
    score: isText ? undefined : line.score,
    box: isText ? undefined : line.box,
    source,
    createdAt: Date.now()
  }
}

@Injectable()
export class SessionService {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly reportsDir = resolve(dataRoot(), "reports")

  constructor(@Inject(AliasService) private readonly aliasService: AliasService) {}

  createSession(): SessionRecord {
    const activeSession = [...this.sessions.values()].find((session) => session.status === "active")
    if (activeSession) {
      activeSession.status = "ended"
      activeSession.exportStatus = "pending"
      activeSession.endedAt = activeSession.endedAt ?? Date.now()
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: SessionRecord = {
      id: sessionId,
      state: createInitialTrackerState(demoDeckProfile),
      status: "active",
      exportStatus: "pending",
      startedAt: Date.now(),
      ocrEngine: "unknown",
      rawOcrLines: [],
      mergedLines: [],
      userCorrections: []
    }

    this.sessions.set(sessionId, session)
    return session
  }

  getSession(id: string): SessionRecord {
    const session = this.sessions.get(id)
    if (!session) {
      throw new NotFoundException(`Session ${id} not found`)
    }

    return session
  }

  listSessions(): SessionRecord[] {
    return [...this.sessions.values()].sort((left, right) => right.startedAt - left.startedAt)
  }

  listEndedPendingSessions(): SessionRecord[] {
    return [...this.sessions.values()].filter(
      (session) => session.status === "ended" && session.exportStatus === "pending"
    )
  }

  applyEvent(id: string, event: ParsedLogEvent): TrackerState {
    const session = this.getSession(id)
    session.state = applyEvent(session.state, event)
    return session.state
  }

  recordOcrBatch(
    id: string,
    input: {
      rawLines?: OcrLine[] | string[] | undefined
      mergedLines?: OcrLine[] | string[] | undefined
      source?: OcrLogRecord["source"] | undefined
      ocrEngine?: string | undefined
    }
  ): SessionRecord {
    const session = this.getSession(id)
    const source = input.source ?? "ocr"
    session.ocrEngine = input.ocrEngine ?? session.ocrEngine
    session.rawOcrLines.push(...(input.rawLines ?? []).map((line, index) => toLogRecord(line, source, index)))
    session.mergedLines.push(...(input.mergedLines ?? []).map((line, index) => toLogRecord(line, source, index)))
    return session
  }

  recordCorrection(
    id: string,
    input: {
      eventId: string
      correctedCardName?: string | undefined
      reason?: UserCorrectionRecord["reason"] | undefined
    }
  ): TrackerState {
    const session = this.getSession(id)
    const event = session.state.events.find((item) => item.id === input.eventId)
    if (!event) {
      throw new NotFoundException(`Event ${input.eventId} not found`)
    }

    session.userCorrections.push({
      id: createRecordId("correction"),
      sessionId: id,
      eventId: event.id,
      rawText: event.rawText,
      previousCardName: event.cardName,
      correctedCardName: input.correctedCardName,
      reason: input.reason ?? "misrecognized",
      createdAt: Date.now()
    })

    session.state = applyEvent(session.state, {
      ...event,
      status: "rejected"
    })
    return session.state
  }

  undo(id: string): TrackerState {
    const session = this.getSession(id)
    session.state = undoLastEvent(session.state)
    return session.state
  }

  reset(id: string): TrackerState {
    const session = this.getSession(id)
    session.state = createInitialTrackerState(session.state.deckProfile)
    session.rawOcrLines = []
    session.mergedLines = []
    session.userCorrections = []
    session.status = "active"
    session.exportStatus = "pending"
    session.startedAt = Date.now()
    session.endedAt = undefined
    return session.state
  }

  async endSession(id: string): Promise<{ session: SessionRecord; report: SessionReport; candidateCount: number; error?: string }> {
    const session = this.getSession(id)
    session.status = "ended"
    session.exportStatus = "pending"
    session.endedAt = session.endedAt ?? Date.now()
    return this.exportAndAnalyze(session)
  }

  async analyzeAliases(id: string): Promise<{ candidateCount: number }> {
    const session = this.getSession(id)
    const report = await this.exportSessionJsonReport(session.id)
    const candidates = await this.aliasService.analyzeReport(report, session.state.deckProfile)
    session.status = "aliasAnalyzed"
    session.exportStatus = "aliasAnalyzed"
    return { candidateCount: candidates.length }
  }

  async exportAndAnalyze(session: SessionRecord): Promise<{ session: SessionRecord; report: SessionReport; candidateCount: number; error?: string }> {
    try {
      const report = await this.exportSessionJsonReport(session.id)
      await this.exportSessionTextReport(session.id)
      session.status = "exported"
      session.exportStatus = "exported"
      const candidates = await this.aliasService.analyzeReport(report, session.state.deckProfile)
      session.status = "aliasAnalyzed"
      session.exportStatus = "aliasAnalyzed"
      session.lastError = undefined
      return { session, report, candidateCount: candidates.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出或分析失败"
      session.exportStatus = "failed"
      session.lastError = message
      const report = this.buildSessionReport(session)
      return { session, report, candidateCount: 0, error: message }
    }
  }

  async exportSessionJsonReport(sessionId: string): Promise<SessionReport> {
    const session = this.getSession(sessionId)
    const report = this.buildSessionReport(session)
    await this.writeJson(this.jsonReportPath(sessionId), report)
    return report
  }

  async exportSessionTextReport(sessionId: string): Promise<string> {
    const session = this.getSession(sessionId)
    const report = this.buildSessionReport(session)
    const candidates = await this.aliasService.getCandidates()
    const sessionCandidates = candidates.filter((candidate) =>
      candidate.examples.some((example) => example.sessionId === sessionId)
    )
    const lines = [
      "# 三国杀 OCR 对局报告",
      "",
      "## 基本信息",
      `sessionId: ${report.sessionId}`,
      `deckProfileId: ${report.deckProfileId}`,
      `start time: ${new Date(report.startedAt).toISOString()}`,
      `end time: ${report.endedAt ? new Date(report.endedAt).toISOString() : "-"}`,
      `OCR engine: ${report.ocrEngine}`,
      `alias dictionary version: ${report.aliasDictionaryVersion ?? "-"}`,
      "",
      "## OCR 原始行",
      ...report.rawOcrLines.map((line) => `${new Date(line.createdAt).toISOString()} ${line.text}`),
      "",
      "## 合并后日志行",
      ...report.mergedLines.map((line) => `${new Date(line.createdAt).toISOString()} ${line.text}`),
      "",
      "## 解析结果",
      ...report.parsedEvents.map((event) =>
        [
          `rawText: ${event.rawText}`,
          `normalizedText: ${event.normalizedText}`,
          `action: ${event.action}`,
          `cardName: ${event.cardName ?? "-"}`,
          `quality: ${event.quality}`,
          `status: ${event.status}`,
          `note: ${event.note ?? "-"}`,
          `appliedAliases: ${event.appliedAliases?.map((alias) => `${alias.alias}->${alias.canonical}`).join(", ") ?? "-"}`
        ].join("\n")
      ),
      "",
      "## 用户修正记录",
      ...report.userCorrections.map((record) =>
        `${new Date(record.createdAt).toISOString()} ${record.reason} ${record.previousCardName ?? "-"} -> ${record.correctedCardName ?? "-"} | ${record.rawText}`
      ),
      "",
      "## Summary",
      JSON.stringify(report.summary, null, 2),
      "",
      "## 候选别名",
      ...(sessionCandidates.length
        ? sessionCandidates.map(
            (candidate) =>
              `${candidate.alias} -> ${candidate.suggestedCanonical} confidence=${candidate.confidence.toFixed(2)} count=${candidate.count} status=${candidate.status}`
          )
        : ["暂无候选别名"])
    ]

    const text = `${lines.join("\n")}\n`
    await this.writeText(this.textReportPath(sessionId), text)
    return text
  }

  async readTextReport(sessionId: string): Promise<string> {
    try {
      return await readFile(this.textReportPath(sessionId), "utf8")
    } catch {
      return this.exportSessionTextReport(sessionId)
    }
  }

  async readJsonReport(sessionId: string): Promise<SessionReport> {
    try {
      return JSON.parse(await readFile(this.jsonReportPath(sessionId), "utf8")) as SessionReport
    } catch {
      return this.exportSessionJsonReport(sessionId)
    }
  }

  private buildSessionReport(session: SessionRecord): SessionReport {
    const events = session.state.events
    const ignoredEvents = events.filter((event) => event.quality === "ignored" || event.status === "ignored")
    const ambiguousEvents = events.filter((event) => event.quality === "ambiguous")
    const unsupportedEvents = events.filter((event) => event.quality === "unsupported" || event.supportStatus === "unsupported")
    const acceptedEvents = events.filter((event) => event.status === "accepted")

    return {
      sessionId: session.id,
      deckProfileId: session.state.deckProfileId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      ocrEngine: session.ocrEngine,
      aliasDictionaryVersion: session.aliasDictionaryVersion,
      rawOcrLines: session.rawOcrLines,
      mergedLines: session.mergedLines,
      parsedEvents: events,
      acceptedEvents,
      ignoredEvents,
      ambiguousEvents,
      unsupportedEvents,
      userCorrections: session.userCorrections,
      summary: {
        rawLineCount: session.rawOcrLines.length,
        mergedLineCount: session.mergedLines.length,
        parsedEventCount: events.length,
        acceptedCount: acceptedEvents.length,
        ignoredCount: ignoredEvents.length,
        ambiguousCount: ambiguousEvents.length,
        unsupportedCount: unsupportedEvents.length,
        correctionCount: session.userCorrections.length
      }
    }
  }

  private textReportPath(sessionId: string): string {
    return resolve(this.reportsDir, `${sessionId}.log.txt`)
  }

  private jsonReportPath(sessionId: string): string {
    return resolve(this.reportsDir, `${sessionId}.analysis.json`)
  }

  private async writeText(filePath: string, text: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, text, "utf8")
  }

  private async writeJson<T>(filePath: string, value: T): Promise<void> {
    await this.writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }
}
