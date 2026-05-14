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
    const candidates = await this.readJson<OcrAliasCandidate[]>(this.candidatePath, [])
    return status ? candidates.filter((candidate) => candidate.status === status) : candidates
  }

  async saveCandidates(candidates: OcrAliasCandidate[]): Promise<void> {
    await this.writeJson(this.candidatePath, candidates)
  }

  async analyzeReport(report: SessionReport, deckProfile: DeckProfile = defaultDeckProfile): Promise<OcrAliasCandidate[]> {
    const aliases = await this.getAliases()
    const mined = analyzeOcrAliasesForReport(report, deckProfile, aliases)
    const existing = await this.getCandidates()
    const merged = this.mergeCandidates(existing, mined)
    await this.saveCandidates(merged)
    return mined
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
      current.count += candidate.count
      current.confidence = Math.max(current.confidence, candidate.confidence)
      current.sources = [...new Set([...current.sources, ...candidate.sources])]
      current.examples = [...current.examples, ...candidate.examples].slice(0, 5)
      current.updatedAt = Date.now()
    }

    return [...byKey.values()]
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
