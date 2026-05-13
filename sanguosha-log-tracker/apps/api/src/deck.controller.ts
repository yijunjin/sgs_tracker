import { Controller, Get } from "@nestjs/common"
import { demoDeckProfile } from "@slt/shared"

@Controller("deck-profiles")
export class DeckController {
  @Get("demo")
  getDemoDeckProfile() {
    return demoDeckProfile
  }
}
