import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common"
import type { OcrAliasCandidate, OcrAliasEntry, TruncatedCardCompletionRule } from "@slt/shared"

import { AliasService } from "./alias.service.js"

@Controller()
export class AliasController {
  constructor(@Inject(AliasService) private readonly aliasService: AliasService) {}

  @Get("ocr-aliases")
  getAliases() {
    return this.aliasService.getAliases()
  }

  @Post("ocr-aliases")
  addAlias(@Body() body: Pick<OcrAliasEntry, "alias" | "canonical"> & Partial<OcrAliasEntry>) {
    return this.aliasService.addAlias(body)
  }

  @Patch("ocr-aliases/:id")
  updateAlias(@Param("id") id: string, @Body() body: Partial<OcrAliasEntry>) {
    return this.aliasService.updateAlias(id, body)
  }

  @Delete("ocr-aliases/:id")
  deleteAlias(@Param("id") id: string) {
    return this.aliasService.deleteAlias(id)
  }

  @Get("ocr-alias-candidates")
  getCandidates(@Query("status") status?: OcrAliasCandidate["status"]) {
    return this.aliasService.getCandidates(status)
  }

  @Get("truncated-card-completions")
  getTruncatedCardCompletions() {
    return this.aliasService.getTruncatedCardCompletions()
  }

  @Post("truncated-card-completions")
  addTruncatedCardCompletion(@Body() body: TruncatedCardCompletionRule) {
    return this.aliasService.addTruncatedCardCompletion(body)
  }

  @Post("ocr-alias-candidates/:id/accept")
  acceptCandidate(@Param("id") id: string) {
    return this.aliasService.acceptCandidate(id)
  }

  @Post("ocr-alias-candidates/:id/accept-truncated-completion")
  acceptCandidateAsTruncatedCompletion(@Param("id") id: string) {
    return this.aliasService.acceptCandidateAsTruncatedCompletion(id)
  }

  @Post("ocr-alias-candidates/:id/reject")
  rejectCandidate(@Param("id") id: string) {
    return this.aliasService.rejectCandidate(id)
  }
}
