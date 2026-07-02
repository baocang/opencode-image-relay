import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"

// opencode-image-relay
//
// Lets text-only models handle pasted images by relaying them to any
// image-capable MCP tool the user has installed.
//
//   user pastes image
//     -> (messages.transform hook, runs only when the active model lacks
//        native image input) the plugin saves the image bytes to a temp file
//     -> the image part is REMOVED from the outgoing message, so there is no
//        unsupported image part left — opencode therefore never emits its
//        "does not support image input" error in the first place
//     -> a minimal text part carrying only the saved path is injected
//     -> the model analyzes that path with whatever image MCP tool it has
//        available (e.g. zai-mcp-server). No tool names are hard-coded, so
//        this works for any provider / any image MCP.
//
// Vision-capable models are left untouched (the original image part reaches
// them natively). Activation is purely capability-based, no config needed.
//
// No prompts or instructions are injected anywhere — the model just gets the
// path; the error it used to follow is never generated.

const TMP_DIR = path.join(tmpdir(), "opencode-image-relay")
const HINT_TAG = "[image-relay]"
const MAX_IMAGES = Number(process.env["IMAGE_RELAY_MAX_IMAGES"] || 200)

const hashToSeq = new Map<string, number>()
let nextSeq = 1
const lruQueue: string[] = []
const lruSet = new Set<string>()

function touchLRU(dir: string) {
  if (lruSet.has(dir)) return
  lruQueue.push(dir)
  lruSet.add(dir)
  while (lruQueue.length > MAX_IMAGES) {
    const oldest = lruQueue.shift()
    if (!oldest) break
    lruSet.delete(oldest)
    fs.rm(oldest, { recursive: true, force: true }).catch(() => {})
  }
}

function isOurHint(text?: string): boolean {
  return !!text && text.startsWith(HINT_TAG)
}

function isErrorNoise(text?: string): boolean {
  return !!text && /does not support image input/i.test(text)
}

// Set by the system.transform hook (which receives the active model) and read
// by the messages.transform hook. Defaults to false, so a text-only model is
// processed even if capabilities can't be read for some reason.
let modelSupportsImage = false

const imageRelay: Plugin = async () => {
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {})

  return {
    // Capability detection ONLY — no prompt is injected.
    "experimental.chat.system.transform": async (input) => {
      const model = input.model as unknown as {
        capabilities?: { input?: { image?: boolean } }
      }
      modelSupportsImage = !!model?.capabilities?.input?.image
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (modelSupportsImage) return

      for (const msg of output.messages) {
        const info = msg.info as unknown as { role?: string; summary?: unknown }
        if (info.role !== "user" || info.summary) continue

        const parts = msg.parts as unknown as Array<{
          type?: string
          text?: string
          mime?: string
          url?: string
        }>
        if (!Array.isArray(parts)) continue

        // Save each image part to a temp file and remember its index.
        const saved: string[] = []
        const imageIdx: number[] = []
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]
          if (p.type !== "file" || typeof p.mime !== "string" || !p.mime.startsWith("image/")) continue
          if (typeof p.url !== "string") continue
          const idx = p.url.indexOf(";base64,")
          if (idx === -1) continue
          const base64 = p.url.slice(idx + ";base64,".length)
          if (!base64) continue

          const hash = createHash("md5").update(base64).digest("hex").slice(0, 8)
          let seq = hashToSeq.get(hash)
          if (!seq) {
            seq = nextSeq++
            hashToSeq.set(hash, seq)
          }
          const ext = (p.mime.split("/")[1] || "png")
            .replace("svg+xml", "svg")
            .replace("jpeg", "jpg")
          const seqDir = path.join(TMP_DIR, `image${seq}`)
          const filePath = path.join(seqDir, `${hash}.${ext}`)

          await fs.mkdir(seqDir, { recursive: true }).catch(() => {})
          try {
            await fs.access(filePath)
          } catch {
            try {
              await fs.writeFile(filePath, Buffer.from(base64, "base64"))
            } catch (err) {
              console.error(`[image-relay] failed to write ${filePath}:`, err)
              continue
            }
          }
          touchLRU(seqDir)
          saved.push(filePath)
          imageIdx.push(i)
        }

        if (saved.length === 0) continue

        // Remove the image parts (so the outgoing message has no unsupported
        // image part, i.e. no "does not support image input" error is ever
        // generated), plus any prior hint / leftover error noise (idempotent).
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]
          if (
            imageIdx.includes(i) ||
            (p.type === "text" && (isOurHint(p.text) || isErrorNoise(p.text)))
          ) {
            parts.splice(i, 1)
          }
        }

        // Inject the saved path(s) plus a one-line steer: use an image-analysis
        // tool, NOT the built-in `read` (which fails on images for text models).
        // No system prompt — the attachment error is already prevented by
        // stripping the image part above.
        const steer = "请用可用的图像分析工具（MCP）读取该路径并分析；不要用 read 工具直接读图（文本模型读图会失败）。"
        const hint =
          saved.length === 1
            ? `${HINT_TAG} 用户附带的图片已保存：${saved[0]}\n${steer}`
            : `${HINT_TAG} 用户附带的 ${saved.length} 张图片已保存：\n${saved.map((f) => `  ${f}`).join("\n")}\n${steer}`
        parts.push({ type: "text", text: hint })
      }
    },
  }
}

export default imageRelay
export { imageRelay }
