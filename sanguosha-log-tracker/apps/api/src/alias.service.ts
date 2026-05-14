import { Injectable } from "@nestjs/common"
import {
  analyzeOcrAliasesForReport,
  builtInOcrAliases,
  defaultDeckProfile,
  setRuntimeOcrAliases,
  type DeckProfile,
  type OcrAliasCandidate,
  type OcrAliasEntry,
  type SessionReport
} from "@slt/shared"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"

function dataRoot(): string {
  const cwd = process.cwd()
  return basename(cwd) === "api" ? resolve(cwd, "data") : resolve(cwd, "apps/api/data")
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${parts.join("-").replace(/[^\p{L}\p{N}_-]+/gu, "-")}`
}

@Injectable()
export class AliasService {
  private readonly aliasesDir = resolve(dataRoot(), "aliases")
  private readonly reportsDir = resolve(dataRoot(), "reports")
  private readonly builtInPath = resolve(this.aliasesDir, "ocr-aliases.built-in.json")
  private readonly userPath = resolve(this.aliasesDir, "ocr-aliases.user.json")
  private readonly candidatePath = resolve(this.aliasesDir, "ocr-alias-candidates.json")

  async ensureStorage(): Promise<void> {
    await mkdir(this.aliasesDir, { recursive: true })
    await this.writeJsonIfMissing(this.builtInPath, builtInOcrAliases)
    await this.writeJsonIfMissing(this.userPath, [])
    await this.writeJsonIfMissing(this.candidatePath, [])
  }

  async getAliases(): Promise<OcrAliasEntry[]> {
    await this.ensureStorage()
    const builtIn = await this.readJson<OcrAliasEntry[]>(this.builtInPath, builtInOcrAliases)
    const user = await this.readJson<OcrAliasEntry[]>(this.userPath, [])
    setRuntimeOcrAliases(user)
    return [...builtIn, ...user]
  }

  async getUserAliases(): Promise<OcrAliasEntry[]> {
    await this.ensureStorage()
    return this.readJson<OcrAliasEntry[]>(this.userPath, [])
  }

  async saveUserAliases(aliases: OcrAliasEntry[]): Promise<void> {
    await this.writeJson(this.userPath, aliases)
    setRuntimeOcrAliases(aliases)
  }

  async getCandidates(status?: OcrAliasCandidate["status"]): Promise<OcrAliasCandidate[]> {
    await this.ensureStorage()
    const candidates = (await this.readJson<OcrAliasCandidate[]>(this.candidatePath, [])).map((candidate) =>
      this.normalizeCandidate(candidate)
    )
    const reconciled = await this.reconcileAcceptedCandidates(candidates)
    const hydrated = await this.hydrateCandidateEvidence(reconciled)
    if (hydrated.changed) {
      await this.saveCandidates(hydrated.candidates)
    }
    return status ? hydrated.candidates.filter((candidate) => candidate.status === status) : hydrated.candidates
  }

  async saveCandidates(candidates: OcrAliasCandidate[]): Promise<void> {
    await this.writeJson(this.candidatePath, candidates)
  }

  async analyzeReport(report: SessionReport, deckProfile: DeckProfile = defaultDeckProfile): Promise<OcrAliasCandidate[]> {
    const aliases = await this.getAliases()
    const mined = analyzeOcrAliasesForReport(report, deckProfile, aliases).map((candidate) => this.normalizeCandidate(candidate))
    const existing = await this.getCandidates()
    const merged = this.mergeCandidates(existing, mined)
    const hydrated = await this.hydrateCandidateEvidence(merged)
    await this.saveCandidates(hydrated.candidates)

    const minedIds = new Set(mined.map((candidate) => candidate.id))
    return hydrated.candidates.filter((candidate) => minedIds.has(candidate.id))
  }

  async acceptCandidate(id: string): Promise<{ candidate: OcrAliasCandidate; alias: OcrAliasEntry }> {
    const candidates = await this.getCandidates()
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) {
      throw new Error(`Alias candidate ${id} not found`)
    }

    candidate.status = "accepted"
    candidate.updatedAt = Date.now()
    const userAliases = await this.getUserAliases()
    const existing = userAliases.find(
      (alias) => alias.alias === candidate.alias && alias.canonical === candidate.suggestedCanonical
    )
    const alias =
      existing ??
      ({
        id: stableId("alias", candidate.alias, candidate.suggestedCanonical),
        alias: candidate.alias,
        canonical: candidate.suggestedCanonical,
        source: "mined",
        confidence: candidate.confidence,
        enabled: true,
        hitCount: 0,
        createdAt: Date.now(),
        note: "由对局结束后的 OCR 别名挖掘生成"
      } satisfies OcrAliasEntry)

    if (!existing) {
      userAliases.push(alias)
    } else if (!existing.enabled) {
      existing.enabled = true
      existing.updatedAt = Date.now()
    }

    await this.saveUserAliases(userAliases)
    await this.saveCandidates(candidates)
    return { candidate, alias }
  }

  async rejectCandidate(id: string): Promise<OcrAliasCandidate> {
    const candidates = await this.getCandidates()
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) {
      throw new Error(`Alias candidate ${id} not found`)
    }
    candidate.status = "rejected"
    candidate.updatedAt = Date.now()
    await this.saveCandidates(candidates)
    return candidate
  }

  async addAlias(input: Pick<OcrAliasEntry, "alias" | "canonical"> & Partial<OcrAliasEntry>): Promise<OcrAliasEntry> {
    const aliases = await this.getUserAliases()
    const now = Date.now()
    const entry: OcrAliasEntry = {
      id: input.id ?? stableId("alias", input.alias, input.canonical),
      alias: input.alias,
      canonical: input.canonical,
      source: input.source === "mined" ? "mined" : "manual",
      confidence: input.confidence ?? 1,
      enabled: input.enabled ?? true,
      hitCount: input.hitCount ?? 0,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      note: input.note
    }
    aliases.push(entry)
    await this.saveUserAliases(aliases)
    return entry
  }

  async updateAlias(id: string, patch: Partial<OcrAliasEntry>): Promise<OcrAliasEntry> {
    const aliases = await this.getUserAliases()
    const index = aliases.findIndex((alias) => alias.id === id)
    if (index < 0 || !aliases[index]) {
      throw new Error(`User alias ${id} not found`)
    }
    aliases[index] = {
      ...aliases[index],
      ...patch,
      id: aliases[index].id,
      source: aliases[index].source,
      updatedAt: Date.now()
    }
    await this.saveUserAliases(aliases)
    return aliases[index]
  }

  async deleteAlias(id: string): Promise<{ ok: true }> {
    const aliases = await this.getUserAliases()
    await this.saveUserAliases(aliases.filter((alias) => alias.id !== id))
    await this.reconcileAcceptedCandidates(await this.getCandidates(), true)
    return { ok: true }
  }

  private mergeCandidates(existing: OcrAliasCandidate[], mined: OcrAliasCandidate[]): OcrAliasCandidate[] {
    const byKey = new Map(existing.map((candidate) => [`${candidate.alias}|${candidate.suggestedCanonical}`, candidate]))

    for (const candidate of mined) {
      const key = `${candidate.alias}|${candidate.suggestedCanonical}`
      const current = byKey.get(key)
      if (!current) {
        byKey.set(key, candidate)
        continue
      }
      if (current.status === "rejected") {
        continue
      }
      const currentExampleKeys = new Set(current.examples.map((example) => this.exampleKey(example)))
      const hasNewExamples = candidate.examples.some((example) => !currentExampleKeys.has(this.exampleKey(example)))
      const hasNewSessions = candidate.sessionIds.some((sessionId) => !current.sessionIds.includes(sessionId))
      if (hasNewExamples || hasNewSessions) {
        current.count += candidate.count
      }
      current.confidence = Math.max(current.confidence, candidate.confidence)
      current.sources = [...new Set([...current.sources, ...candidate.sources])]
      current.sessionIds = [...new Set([...current.sessionIds, ...candidate.sessionIds])]
      current.examples = this.mergeExamples(current.examples, candidate.examples)
      current.updatedAt = Date.now()
    }

    return [...byKey.values()]
  }

  private exampleKey(example: OcrAliasCandidate["examples"][number]): string {
    return `${example.sessionId}|${example.eventId ?? "-"}|${example.rawText}`
  }

  private mergeExamples(
    ...groups: Array<OcrAliasCandidate["examples"]>
  ): OcrAliasCandidate["examples"] {
    const byKey = new Map<string, OcrAliasCandidate["examples"][number]>()

    for (const example of groups.flat()) {
      const key = this.exampleKey(example)
      const current = byKey.get(key)
      if (!current) {
        byKey.set(key, example)
        continue
      }

      if (!current.evidenceImage && example.evidenceImage) {
        byKey.set(key, {
          ...current,
          evidenceImage: example.evidenceImage
        })
      }
    }

    return [...byKey.values()]
      .sort((left, right) => Number(Boolean(right.evidenceImage)) - Number(Boolean(left.evidenceImage)))
      .slice(0, 5)
  }

  private normalizeCandidate(candidate: OcrAliasCandidate): OcrAliasCandidate {
    const sessionIds = candidate.sessionIds?.length
      ? candidate.sessionIds
      : [...new Set(candidate.examples.map((example) => example.sessionId).filter(Boolean))]

    return {
      ...candidate,
      sessionIds
    }
  }

  private async hydrateCandidateEvidence(
    candidates: OcrAliasCandidate[]
  ): Promise<{ candidates: OcrAliasCandidate[]; changed: boolean }> {
    const reportCache = new Map<string, Promise<SessionReport | undefined>>()
    let changed = false

    const getReport = (sessionId: string): Promise<SessionReport | undefined> => {
      const cached = reportCache.get(sessionId)
      if (cached) {
        return cached
      }

      const promise = this.readJson<SessionReport | undefined>(
        resolve(this.reportsDir, `${sessionId}.analysis.json`),
        undefined
      )
      reportCache.set(sessionId, promise)
      return promise
    }

    const nextCandidates: OcrAliasCandidate[] = []
    for (const candidate of candidates) {
      const nextExamples: OcrAliasCandidate["examples"] = []

      for (const example of candidate.examples) {
        if (example.evidenceImage || !example.eventId) {
          nextExamples.push(example)
          continue
        }

        const report = await getReport(example.sessionId)
        const sourceEvent = report?.parsedEvents.find((event) => event.id === example.eventId)
        if (!sourceEvent?.evidenceImage) {
          nextExamples.push(example)
          continue
        }

        changed = true
        nextExamples.push({
          ...example,
          evidenceImage: sourceEvent.evidenceImage
        })
      }

      nextCandidates.push({
        ...candidate,
        examples: this.mergeExamples(nextExamples)
      })
    }

    return { candidates: nextCandidates, changed }
  }

  private async reconcileAcceptedCandidates(
    candidates: OcrAliasCandidate[],
    forceSave = false
  ): Promise<OcrAliasCandidate[]> {
    const aliases = await this.getUserAliases()
    const aliasKeys = new Set(aliases.map((alias) => this.candidateKey(alias.alias, alias.canonical)))
    let changed = forceSave

    const reconciled = candidates.map((candidate) => {
      if (candidate.status !== "accepted") {
        return candidate
      }

      if (aliasKeys.has(this.candidateKey(candidate.alias, candidate.suggestedCanonical))) {
        return candidate
      }

      changed = true
      return {
        ...candidate,
        status: "pending" as const,
        updatedAt: Date.now()
      }
    })

    if (changed) {
      await this.saveCandidates(reconciled)
    }

    return reconciled
  }

  private candidateKey(alias: string, canonical: string): string {
    return `${alias}|${canonical}`
  }

  private async writeJsonIfMissing<T>(filePath: string, value: T): Promise<void> {
    try {
      await readFile(filePath, "utf8")
    } catch {
      await this.writeJson(filePath, value)
    }
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T
    } catch {
      return fallback
    }
  }

  private async writeJson<T>(filePath: string, value: T): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  }
}
