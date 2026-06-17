import { createServer } from "node:http"
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"

const port = Number(process.env.SGS_COLLECTOR_PORT || 18765)
const outDir = process.env.SGS_COLLECTOR_DIR || join(process.cwd(), "..", "captures", "extension-runs", "background")

mkdirSync(outDir, { recursive: true })

const jsonlPath = join(outDir, `snapshots-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`)
const latestPath = join(outDir, "latest.json")
const instancesIndexPath = join(outDir, "instances-index.json")
const gameOverPath = join(outDir, "game-over-latest.json")
const instances = new Map()

function safeFilePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
}

function send(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Content-Type": "application/json; charset=utf-8"
  })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {})
    return
  }

  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true, outDir, jsonlPath, instancesIndexPath })
    return
  }

  if (req.method !== "POST" || req.url !== "/snapshot") {
    send(res, 404, { ok: false, error: "not found" })
    return
  }

  let raw = ""
  req.setEncoding("utf8")
  req.on("data", (chunk) => {
    raw += chunk
    if (raw.length > 8 * 1024 * 1024) {
      req.destroy()
    }
  })
  req.on("end", () => {
    try {
      const payload = JSON.parse(raw)
      const enriched = {
        receivedAt: new Date().toISOString(),
        ...payload
      }
      const line = JSON.stringify(enriched)
      appendFileSync(jsonlPath, `${line}\n`, "utf8")
      writeFileSync(latestPath, `${JSON.stringify(enriched, null, 2)}\n`, "utf8")
      const instanceId = safeFilePart(enriched.pageInstanceId || enriched.diagnostics?.pageInstanceId)
      const instanceLatestPath = join(outDir, `latest-${instanceId}.json`)
      writeFileSync(instanceLatestPath, `${JSON.stringify(enriched, null, 2)}\n`, "utf8")
      instances.set(instanceId, {
        pageInstanceId: instanceId,
        latestPath: instanceLatestPath,
        pageUrl: enriched.pageUrl,
        exportedAt: enriched.exportedAt,
        receivedAt: enriched.receivedAt,
        reason: enriched.reason,
        exact: enriched.exactCardStates?.length ?? enriched.seenExactCards?.length ?? 0,
        drawPileRemaining: enriched.drawPileRemaining,
        gameOverCount: enriched.status?.gameOverCount ?? 0,
        contentVersion: enriched.diagnostics?.contentVersion,
        hookVersion: enriched.status?.hookVersion
      })
      writeFileSync(instancesIndexPath, `${JSON.stringify([...instances.values()], null, 2)}\n`, "utf8")
      if (enriched.status?.gameOverCount > 0 || enriched.reason === "game-over") {
        writeFileSync(gameOverPath, `${JSON.stringify(enriched, null, 2)}\n`, "utf8")
      }
      send(res, 200, { ok: true })
    } catch (error) {
      send(res, 400, { ok: false, error: String(error) })
    }
  })
})

server.listen(port, "127.0.0.1")
