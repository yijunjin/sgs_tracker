import { access, cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

async function resolveOrtPackageJsonPath() {
  try {
    return require.resolve("onnxruntime-web/package.json");
  } catch {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..", "..", "..");
    const pnpmStoreDir = path.join(repoRoot, "node_modules", ".pnpm");
    const pnpmEntries = await readdir(pnpmStoreDir, { withFileTypes: true });
    const match = pnpmEntries.find(
      (entry) => entry.isDirectory() && entry.name.startsWith("onnxruntime-web@")
    );

    if (!match) {
      throw new Error("Unable to locate onnxruntime-web inside node_modules/.pnpm.");
    }

    const candidate = path.join(
      pnpmStoreDir,
      match.name,
      "node_modules",
      "onnxruntime-web",
      "package.json"
    );

    await access(candidate);
    return candidate;
  }
}

async function main() {
  const ortPackageJsonPath = await resolveOrtPackageJsonPath();
  const ortDistDir = path.join(path.dirname(ortPackageJsonPath), "dist");
  const targetDir = path.resolve(process.cwd(), "src", "vendor", "ort");

  await mkdir(targetDir, { recursive: true });

  const entries = await readdir(ortDistDir, { withFileTypes: true });
  const candidates = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith("ort-wasm") &&
      (entry.name.endsWith(".wasm") || entry.name.endsWith(".mjs"))
  );

  await Promise.all(
    candidates.map((entry) =>
      cp(path.join(ortDistDir, entry.name), path.join(targetDir, entry.name), { force: true })
    )
  );

  console.log(`[sync:ort-assets] copied ${candidates.length} ONNX Runtime assets to ${targetDir}`);
}

main().catch((error) => {
  console.error("[sync:ort-assets] failed", error);
  process.exit(1);
});
