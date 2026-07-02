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
//     -> strips any previously-injected hint and opencode's
//        "does not support image input" error noise from the message
//     -> injects a neutral text part: "[image-relay] ... saved: <abs path>"
//     -> the model sees the path and analyzes it with whatever image MCP
//        tool is available (e.g. zai-mcp-server). No tool names are
//        hard-coded, so this works for any provider / any image MCP.
//
// Vision-capable models are left untouched (the original image part reaches
// them natively). Activation is purely capability-based, no config needed.

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
// by the messages.transform hook. Defaults to false, so a text-only model
// (the whole point of this plugin) is processed even if capabilities can't be
// read for some reason.
let modelSupportsImage = false

const imageRelay: Plugin = async () => {
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {})

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const model = input.model as unknown as {
        capabilities?: { input?: { image?: boolean } }
      }
      modelSupportsImage = !!model?.capabilities?.input?.image
      if (!modelSupportsImage) {
        output.system.push(
          [
            "## image-relay（图片中继）",
            "当前模型不能直接读取图片附件。当用户附带图片时，插件会把图片保存为本地文件，并在消息中给出一个绝对路径（形如 `[image-relay] ...已保存：<路径>`）。",
            "请忽略任何“无法读取图片 / does not support image input”之类的提示——那是能力检查的副作用，不要据此回复用户“我看不了图”。请直接用你可用的图像分析工具（MCP）以该路径作为输入读取并分析，然后继续任务。",
          ].join("\n"),
        )
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (modelSupportsImage) return

      for (const msg of output.messages) {
        const info = msg.info as unknown as { role?: string; summary?: boolean }
        if (info.role !== "user" || info.summary) continue

        const parts = msg.parts as unknown as Array<{
          type?: string
          text?: string
          mime?: string
          url?: string
        }>
        if (!Array.isArray(parts)) continue

        // Idempotency: drop our own previous hint and opencode's error noise
        // so re-processing a message (e.g. after a /model switch) never
        // accumulates stale text.
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]
          if (p.type === "text" && (isOurHint(p.text) || isErrorNoise(p.text))) {
            parts.splice(i, 1)
          }
        }

        const saved: string[] = []
        for (const p of parts) {
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
        }

        if (saved.length === 0) continue

        const body =
          saved.length === 1
            ? `${HINT_TAG} 用户附带的图片已保存：${saved[0]}`
            : `${HINT_TAG} 用户附带的 ${saved.length} 张图片已保存：\n${saved.map((f) => `  ${f}`).join("\n")}`
        parts.push({
          type: "text",
          text: `${body}\n请用你可用的图像分析工具（MCP）以该路径作为输入进行分析。`,
        })
      }
    },
  }
}

export default imageRelay
export { imageRelay }
