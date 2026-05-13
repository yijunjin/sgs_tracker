import "reflect-metadata"

import { NestFactory } from "@nestjs/core"

import { AppModule } from "./app.module.js"

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  app.enableCors({
    origin: true,
    credentials: false
  })

  const port = Number.parseInt(process.env.PORT ?? "3000", 10)
  await app.listen(port)
  console.log(`sanguosha-log-tracker-api listening on http://localhost:${port}`)
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to bootstrap API", error)
  process.exit(1)
})
