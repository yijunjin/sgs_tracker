import { Injectable } from "@nestjs/common"
import {
  analyzeOcrAliasesForReport,
  builtInOcrAliases,
  classifyAliasCandidate,
  defaultDeckProfile,
  deckProfiles,
  setRuntimeOcrAliases,
  type DeckProfile,
  type OcrAliasCandidate,
  type OcrAliasEntry,
  type SessionReport,
  type TruncatedCardCompletionRule
} from "@slt/shared"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"

function dataRoot(): string {
  const cwd = process.cwd()
  return basename(cwd) === "api" ? resolve(cwd, "data") : resolve(cwd, "apps/api/data")
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${parts.join("-").replace(/[^\p{L}\p{N}_-]+/gu, "-")}`
}

const deckProfileById = new Map(deckProfiles.map((profile) => [profile.id, profile]))

@Injectable()
export class AliasService {
  private readonly aliasesDir = resolve(dataRoot(), "aliases")
  private readonly reportsDir = resolve(dataRoot(), "reports")
  private readonly builtInPath = resolve(this.aliasesDir, "ocr-aliases.built-in.json")
  private readonly userPath = resolve(this.aliasesDir, "ocr-aliases.user.json")
  private readonly candidatePath = resolve(this.aliasesDir, "ocr-alias-candidates.json")
  private readonly truncatedCompletionPath = resolve(this.aliasesDir, "truncated-card-completions.json")

  async ensureStorage(): Promise<void> {
    await mkdir(this.aliasesDir, { recursive: true })
    await this.writeJsonIfMissing(this.builtInPath, builtInOcrAliases)
    await this.writeJsonIfMissing(this.userPath, [])
    await this.writeJsonIfMissing(this.candidatePath, [])
    await this.writeJsonIfMissing(this.truncatedCompletionPath, [])
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

  async getTruncatedCardCompletions(): Promise<TruncatedCardCompletionRule[]> {
    await this.ensureStorage()
    return this.readJson<TruncatedCardCompletionRule[]>(this.truncatedCompletionPath, [])
  }

  async saveTruncatedCardCompletions(rules: TruncatedCardCompletionRule[]): Promise<void> {
    await this.writeJson(this.truncatedCompletionPath, rules)
  }

  async addTruncatedCardCompletion(rule: TruncatedCardCompletionRule): Promise<TruncatedCardCompletionRule> {
    const rules = await this.getTruncatedCardCompletions()
    const existing = rules.find(
      (item) => item.fragment === rule.fragment && item.canonical === rule.canonical && item.direction === rule.direction
    )
    if (existing) {
      return existing
    }
    rules.push(rule)
    await this.saveTruncatedCardCompletions(rules)
    return rule
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
    const existing = await this.getCandidates()
    const rebuilt = await this.rebuildCandidatesFromReports(existing, aliases, report, deckProfile)
    const hydrated = await this.hydrateCandidateEvidence(rebuilt)
    await this.saveCandidates(hydrated.candidates)

    return hydrated.candidates.filter((candidate) => candidate.sessionIds.includes(report.sessionId))
  }

  async acceptCandidate(id: string): Promise<{ candidate: OcrAliasCandidate; alias: OcrAliasEntry }> {
    const candidates = await this.getCandidates()
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) {
      throw new Error(`Alias candidate ${id} not found`)
    }
    if (!candidate.canAcceptAsAlias) {
      throw new Error(candidate.note ?? "该候选不适合直接写入 OCR alias 字典")
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

  async acceptCandidateAsTruncatedCompletion(
    id: string
  ): Promise<{ candidate: OcrAliasCandidate; rule: TruncatedCardCompletionRule }> {
    const candidates = await this.getCandidates()
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) {
      throw new Error(`Alias candidate ${id} not found`)
    }
    if (candidate.kind !== "truncated-prefix" && candidate.kind !== "truncated-suffix") {
      throw new Error("只有截断补全候选才能加入截断补全规则")
    }

    candidate.status = "accepted"
    candidate.updatedAt = Date.now()

    const rules = await this.getTruncatedCardCompletions()
    const direction = candidate.kind === "truncated-suffix" ? "prefix-missing" : "suffix-missing"
    const existing = rules.find(
      (rule) => rule.fragment === candidate.alias && rule.canonical === candidate.suggestedCanonical && rule.direction === direction
    )
    const rule =
      existing ??
      ({
        id: stableId("truncated", candidate.alias, candidate.suggestedCanonical, direction),
        fragment: candidate.alias,
        canonical: candidate.suggestedCanonical,
        direction,
        enabled: true,
        confidence: candidate.confidence,
        createdAt: Date.now(),
        note: candidate.note ?? "由别名学习中心确认的截断补全规则"
      } satisfies TruncatedCardCompletionRule)

    if (!existing) {
      rules.push(rule)
    } else if (!existing.enabled) {
      existing.enabled = true
      existing.note = candidate.note ?? existing.note
      existing.confidence = Math.max(existing.confidence, candidate.confidence)
    }

    await this.saveTruncatedCardCompletions(rules)
    await this.saveCandidates(candidates)
    return { candidate, rule }
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
      current.canAcceptAsAlias = current.canAcceptAsAlias && candidate.canAcceptAsAlias
      current.sources = [...new Set([...current.sources, ...candidate.sources])]
      current.sessionIds = [...new Set([...current.sessionIds, ...candidate.sessionIds])]
      current.examples = this.mergeExamples(current.examples, candidate.examples)
      if (current.kind === "ocr-alias" && candidate.kind !== "ocr-alias") {
        current.kind = candidate.kind
      }
      current.note = current.note ?? candidate.note
      current.updatedAt = Date.now()
    }

    return [...byKey.values()]
  }

  private async rebuildCandidatesFromReports(
    existing: OcrAliasCandidate[],
    aliases: OcrAliasEntry[],
    currentReport: SessionReport,
    currentDeckProfile: DeckProfile
  ): Promise<OcrAliasCandidate[]> {
    const rebuilt: OcrAliasCandidate[] = []
    const reportFiles = (await readdir(this.reportsDir)).filter((fileName: string) => fileName.endsWith(".analysis.json"))
    const reports = await Promise.all(
      reportFiles.map((fileName: string) =>
        this.readJson<SessionReport | undefined>(resolve(this.reportsDir, fileName), undefined)
      )
    )

    for (const savedReport of reports) {
      if (!savedReport || savedReport.sessionId === currentReport.sessionId) {
        continue
      }

      const mined = analyzeOcrAliasesForReport(savedReport, this.resolveDeckProfile(savedReport.deckProfileId), aliases).map(
        (candidate) => this.normalizeCandidate(candidate)
      )
      this.mergeCandidates(rebuilt, mined)
    }

    const currentMined = analyzeOcrAliasesForReport(currentReport, currentDeckProfile, aliases).map((candidate) =>
      this.normalizeCandidate(candidate)
    )
    this.mergeCandidates(rebuilt, currentMined)

    return rebuilt.map((candidate) => {
      const previous = existing.find(
        (item) => item.alias === candidate.alias && item.suggestedCanonical === candidate.suggestedCanonical
      )
      if (!previous) {
        return candidate
      }

      return {
        ...candidate,
        status: previous.status,
        createdAt: previous.createdAt ?? candidate.createdAt,
        updatedAt: previous.updatedAt ?? candidate.updatedAt,
        note: previous.note ?? candidate.note
      }
    })
  }

  private resolveDeckProfile(deckProfileId: string | undefined): DeckProfile {
    return (deckProfileId ? deckProfileById.get(deckProfileId) : undefined) ?? defaultDeckProfile
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
        continue
      }

      if (!current.lineBox && example.lineBox) {
        byKey.set(key, {
          ...current,
          lineBox: example.lineBox
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
    const classification = classifyAliasCandidate(candidate.alias, candidate.suggestedCanonical)
    const derivedKind =
      candidate.sources.includes("userCorrection") &&
      classification.kind !== "truncated-prefix" &&
      classification.kind !== "truncated-suffix" &&
      classification.kind !== "dirty-text"
        ? "user-correction"
        : classification.kind

    return {
      ...candidate,
      kind: candidate.kind ?? derivedKind,
      canAcceptAsAlias: candidate.canAcceptAsAlias ?? (derivedKind === "user-correction" ? true : classification.canAcceptAsAlias),
      note: candidate.note ?? classification.note,
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
          const report = example.lineBox ? undefined : await getReport(example.sessionId)
          const sourceLine = report?.mergedLines.find((line) => line.text === example.rawText)
          nextExamples.push(sourceLine?.box && !example.lineBox ? { ...example, lineBox: sourceLine.box } : example)
          continue
        }

        const report = await getReport(example.sessionId)
        const sourceEvent = report?.parsedEvents.find((event) => event.id === example.eventId)
        const sourceLine = report?.mergedLines.find((line) => line.text === example.rawText)
        if (!sourceEvent?.evidenceImage) {
          nextExamples.push(sourceLine?.box && !example.lineBox ? { ...example, lineBox: sourceLine.box } : example)
          continue
        }

        changed = true
        nextExamples.push({
          ...example,
          evidenceImage: sourceEvent.evidenceImage,
          lineBox: example.lineBox ?? sourceLine?.box
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
    const rules = await this.getTruncatedCardCompletions()
    const aliasKeys = new Set(aliases.map((alias) => this.candidateKey(alias.alias, alias.canonical)))
    const completionRuleKeys = new Set(rules.map((rule) => this.truncatedRuleKey(rule.fragment, rule.canonical, rule.direction)))
    let changed = forceSave

    const reconciled = candidates.map((candidate) => {
      if (candidate.status !== "accepted") {
        return candidate
      }

      if (candidate.canAcceptAsAlias && aliasKeys.has(this.candidateKey(candidate.alias, candidate.suggestedCanonical))) {
        return candidate
      }

      if (
        !candidate.canAcceptAsAlias &&
        (candidate.kind === "truncated-prefix" || candidate.kind === "truncated-suffix") &&
        completionRuleKeys.has(
          this.truncatedRuleKey(
            candidate.alias,
            candidate.suggestedCanonical,
            candidate.kind === "truncated-suffix" ? "prefix-missing" : "suffix-missing"
          )
        )
      ) {
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

  private truncatedRuleKey(
    fragment: string,
    canonical: string,
    direction: TruncatedCardCompletionRule["direction"]
  ): string {
    return `${fragment}|${canonical}|${direction}`
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
