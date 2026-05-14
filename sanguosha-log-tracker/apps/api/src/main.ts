import "reflect-metadata"

import { NestFactory } from "@nestjs/core"
import { createServer } from "node:net"

import { AppModule } from "./app.module.js"

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port)
  })
}

async function findAvailablePort(preferredPort: number): Promise<number> {
  const maxAttempts = 20
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferredPort + offset
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(`No available API port found from ${preferredPort} to ${preferredPort + maxAttempts - 1}`)
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  app.enableCors({
    origin: true,
    credentials: false
  })

  const preferredPort = Number.parseInt(process.env.PORT ?? "3000", 10)
  const port = await findAvailablePort(preferredPort)
  if (port !== preferredPort) {
    console.warn(`API port ${preferredPort} is in use, using http://localhost:${port} instead`)
  }

  await app.listen(port)
  console.log(`sanguosha-log-tracker-api listening on http://localhost:${port}`)
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to bootstrap API", error)
  process.exit(1)
})
