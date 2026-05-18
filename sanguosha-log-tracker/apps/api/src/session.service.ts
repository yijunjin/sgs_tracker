import { Inject, Injectable, NotFoundException } from "@nestjs/common"
import {
  applyEvent,
  createInitialTrackerState,
  demoDeckProfile,
  undoLastEvent,
  type OcrAliasCandidate,
  type OcrLine,
  type OcrLogRecord,
  type ParsedLogEvent,
  type SessionExportStatus,
  type SessionReport,
  type TrackerState,
  type UserCorrectionRecord
} from "@slt/shared"
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
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

interface CreateSessionOptions {
  endActive?: boolean
}

interface CleanupEmptySessionsResult {
  removedSessionIds: string[]
  removedReportFiles: string[]
}

export interface SessionListItem {
  sessionId: string
  status: SessionStatus
  exportStatus: SessionExportStatus
  startedAt: number
  endedAt?: number | undefined
  deckProfileId: string
  summary: {
    rawLineCount: number
    mergedLineCount: number
    parsedEventCount: number
    ambiguousCount: number
    unknownCount: number
    correctionCount: number
  }
  lastError?: string | undefined
}

const MIN_REAL_GAME_RAW_LINES = 50
const MIN_REAL_GAME_PARSED_EVENTS = 20

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

  createSession(options: CreateSessionOptions = {}): SessionRecord {
    const activeSession = [...this.sessions.values()].find((session) => session.status === "active")
    if (activeSession) {
      if (!options.endActive) {
        return activeSession
      }

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

  async listSessionSummaries(): Promise<SessionListItem[]> {
    const memorySessions = this.listSessions().map((session) => this.sessionToListItem(session))
    const seenSessionIds = new Set(memorySessions.map((session) => session.sessionId))
    const diskReports = await this.listDiskReports()
    const diskSessions = diskReports
      .filter((report) => !seenSessionIds.has(report.sessionId))
      .map((report) => this.reportToListItem(report))

    return [...memorySessions, ...diskSessions]
      .filter((session) => session.status === "active" || this.isMeaningfulSessionListItem(session))
      .sort((left, right) => right.startedAt - left.startedAt)
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

  async analyzeAliases(id: string): Promise<{ candidateCount: number; candidates: OcrAliasCandidate[] }> {
    const session = this.sessions.get(id)
    const report = session ? await this.exportSessionJsonReport(session.id) : await this.readJsonReport(id)
    const candidates = await this.aliasService.analyzeReport(report, session?.state.deckProfile ?? demoDeckProfile)
    if (session) {
      session.status = "aliasAnalyzed"
      session.exportStatus = "aliasAnalyzed"
    }
    return { candidateCount: candidates.length, candidates }
  }

  async cleanupEmptySessions(): Promise<CleanupEmptySessionsResult> {
    const removedSessionIds: string[] = []
    const removedReportFiles: string[] = []

    for (const session of this.sessions.values()) {
      if (session.status === "active" || !this.isEmptySession(session)) {
        continue
      }

      this.sessions.delete(session.id)
      removedSessionIds.push(session.id)
    }

    await mkdir(this.reportsDir, { recursive: true })
    const reportFiles = await readdir(this.reportsDir)
    const emptyReportIds = new Set<string>()

    for (const fileName of reportFiles) {
      if (!fileName.endsWith(".analysis.json")) {
        continue
      }

      try {
        const report = JSON.parse(await readFile(resolve(this.reportsDir, fileName), "utf8")) as SessionReport
        if (this.isEmptyReport(report)) {
          emptyReportIds.add(report.sessionId)
        }
      } catch {
        continue
      }
    }

    for (const sessionId of emptyReportIds) {
      for (const filePath of [this.jsonReportPath(sessionId), this.textReportPath(sessionId)]) {
        try {
          await unlink(filePath)
          removedReportFiles.push(filePath)
        } catch {
          // Ignore already-missing paired report files.
        }
      }
    }

    return { removedSessionIds, removedReportFiles }
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
              [
                `${candidate.alias} -> ${candidate.suggestedCanonical}`,
                `类型：${candidate.kind === "truncated-prefix" || candidate.kind === "truncated-suffix" ? "截断补全" : candidate.kind === "user-correction" ? "人工修正" : candidate.kind === "dirty-text" ? "疑似脏文本" : "OCR误识别"}`,
                `confidence=${candidate.confidence.toFixed(2)} count=${candidate.count} status=${candidate.status}`,
                candidate.kind === "truncated-prefix" || candidate.kind === "truncated-suffix"
                  ? "建议：优先检查 ROI 或行框 padding，不建议加入别名字典"
                  : `建议：${candidate.canAcceptAsAlias ? "可加入 OCR alias 字典" : "建议人工复核后再决定"}`
              ].join("\n")
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

  private isEmptySession(session: SessionRecord): boolean {
    return (
      session.rawOcrLines.length === 0 &&
      session.mergedLines.length === 0 &&
      session.state.events.length === 0 &&
      session.userCorrections.length === 0
    )
  }

  private isEmptyReport(report: SessionReport): boolean {
    return (
      report.summary.rawLineCount === 0 &&
      report.summary.mergedLineCount === 0 &&
      report.summary.parsedEventCount === 0 &&
      report.summary.acceptedCount === 0 &&
      report.summary.ignoredCount === 0 &&
      report.summary.ambiguousCount === 0 &&
      report.summary.unsupportedCount === 0 &&
      report.summary.correctionCount === 0
    )
  }

  private async listDiskReports(): Promise<SessionReport[]> {
    try {
      await mkdir(this.reportsDir, { recursive: true })
      const fileNames = await readdir(this.reportsDir)
      const reports: SessionReport[] = []

      for (const fileName of fileNames) {
        if (!fileName.endsWith(".analysis.json")) {
          continue
        }

        try {
          reports.push(JSON.parse(await readFile(resolve(this.reportsDir, fileName), "utf8")) as SessionReport)
        } catch {
          // Ignore malformed or partially-written report files.
        }
      }

      return reports
    } catch {
      return []
    }
  }

  private sessionToListItem(session: SessionRecord): SessionListItem {
    return {
      sessionId: session.id,
      status: session.status,
      exportStatus: session.exportStatus,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      deckProfileId: session.state.deckProfileId,
      summary: {
        rawLineCount: session.rawOcrLines.length,
        mergedLineCount: session.mergedLines.length,
        parsedEventCount: session.state.events.length,
        ambiguousCount: session.state.events.filter((event) => event.quality === "ambiguous").length,
        unknownCount: session.state.events.filter((event) => event.action === "unknown").length,
        correctionCount: session.userCorrections.length
      },
      lastError: session.lastError
    }
  }

  private reportToListItem(report: SessionReport): SessionListItem {
    return {
      sessionId: report.sessionId,
      status: "aliasAnalyzed",
      exportStatus: "aliasAnalyzed",
      startedAt: report.startedAt,
      endedAt: report.endedAt,
      deckProfileId: report.deckProfileId,
      summary: {
        rawLineCount: report.summary.rawLineCount,
        mergedLineCount: report.summary.mergedLineCount,
        parsedEventCount: report.summary.parsedEventCount,
        ambiguousCount: report.summary.ambiguousCount,
        unknownCount: report.parsedEvents.filter((event) => event.action === "unknown").length,
        correctionCount: report.summary.correctionCount
      }
    }
  }

  private isMeaningfulSessionListItem(session: SessionListItem): boolean {
    return (
      session.summary.rawLineCount >= MIN_REAL_GAME_RAW_LINES ||
      session.summary.parsedEventCount >= MIN_REAL_GAME_PARSED_EVENTS ||
      session.summary.ambiguousCount > 0 ||
      session.summary.unknownCount > 0 ||
      session.summary.correctionCount > 0
    )
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
