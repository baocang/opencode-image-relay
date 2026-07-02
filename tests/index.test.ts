import { describe, it, expect } from "bun:test"
import { exists } from "node:fs/promises"
import plugin from "../src/index"

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

type Part = { type?: string; text?: string; mime?: string; url?: string }

function userMsg(parts: Part[]) {
  return { info: { role: "user" }, parts }
}

async function run(modelImageCap: boolean, msg: { info: object; parts: Part[] }) {
  const hooks = await (plugin as () => Promise<Record<string, unknown>>)()
  const sysOut = { system: [] as string[] }
  await (hooks["experimental.chat.system.transform"] as Function)(
    { model: { capabilities: { input: { image: modelImageCap } } } },
    sysOut,
  )
  await (hooks["experimental.chat.messages.transform"] as Function)({}, { messages: [msg] })
  return { sysOut, msg }
}

const hintOf = (m: { parts: Part[] }) =>
  m.parts.find((p) => p.type === "text" && p.text?.startsWith("[image-relay]"))

describe("image-relay", () => {
  it("text-only model: injects system prompt, saves file, keeps original part, strips error noise", async () => {
    const msg = userMsg([
      { type: "text", text: "这是什么？" },
      { type: "text", text: 'Cannot read "x.png" (this model does not support image input). Inform the user.' },
      { type: "file", mime: "image/png", url: "data:image/png;base64," + PNG_1x1 },
    ])
    const { sysOut, msg: m } = await run(false, msg)

    expect(sysOut.system.length).toBeGreaterThan(0)
    const texts = m.parts.filter((p) => p.type === "text").map((p) => p.text)
    expect(texts.some((t) => /does not support image input/i.test(t as string))).toBe(false)
    expect(m.parts.some((p) => p.type === "file")).toBe(true)
    const hint = hintOf(m)
    expect(hint).toBeTruthy()
    const match = (hint!.text as string).match(/已保存：(\S+)/)
    expect(match).toBeTruthy()
    expect(await exists(match![1])).toBe(true)
  })

  it("vision-capable model: passed through untouched", async () => {
    const msg = userMsg([
      { type: "text", text: "看图" },
      { type: "file", mime: "image/png", url: "data:image/png;base64," + PNG_1x1 },
    ])
    const before = msg.parts.length
    const { msg: m } = await run(true, msg)
    expect(m.parts.length).toBe(before)
    expect(hintOf(m)).toBeUndefined()
  })

  it("is idempotent: re-running transform does not duplicate hints", async () => {
    const msg = userMsg([
      { type: "text", text: "看图" },
      { type: "file", mime: "image/png", url: "data:image/png;base64," + PNG_1x1 },
    ])
    await run(false, msg)
    await run(false, msg)
    const hints = msg.parts.filter((p) => p.type === "text" && p.text?.startsWith("[image-relay]"))
    expect(hints.length).toBe(1)
  })

  it("ignores non-image file parts", async () => {
    const msg = userMsg([
      { type: "text", text: "hi" },
      { type: "file", mime: "text/plain", url: "data:text/plain;base64,aGVsbG8=" },
    ])
    const { msg: m } = await run(false, msg)
    expect(hintOf(m)).toBeUndefined()
  })

  it("handles multiple images in one message", async () => {
    const msg = userMsg([
      { type: "file", mime: "image/png", url: "data:image/png;base64," + PNG_1x1 },
      { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64," + PNG_1x1 },
    ])
    const { msg: m } = await run(false, msg)
    const hint = hintOf(m)
    expect(hint).toBeTruthy()
    expect((hint!.text as string).includes("2 张")).toBe(true)
  })
})
