import { describe, it, expect } from "vitest";
import { LangfuseBacked } from "../main.js";

type RawBackup = Parameters<typeof LangfuseBacked.normalizeBackup>[0];

describe("normalizeBackup", () => {
  it("v3 message type becomes chatmessage", () => {
    const backup: RawBackup = {
      "my-prompt": {
        type: "chat",
        labels: {
          production: [{ role: "system", content: "Hello", type: "message" }],
        },
      },
    };
    const result = LangfuseBacked.normalizeBackup(backup);
    const msg = (result["my-prompt"].labels["production"] as unknown as Record<string, unknown>[])[0];
    expect(msg["type"]).toBe("chatmessage");
  });

  it("v3 placeholder object becomes placeholder type", () => {
    const backup: RawBackup = {
      "my-prompt": {
        type: "chat",
        labels: {
          production: [{ name: "history" }],
        },
      },
    };
    const result = LangfuseBacked.normalizeBackup(backup);
    const msg = (result["my-prompt"].labels["production"] as unknown as Record<string, unknown>[])[0];
    expect(msg["type"]).toBe("placeholder");
  });

  it("v4 chatmessage type unchanged", () => {
    const backup: RawBackup = {
      "my-prompt": {
        type: "chat",
        labels: {
          production: [{ role: "user", content: "Hi", type: "chatmessage" }],
        },
      },
    };
    const result = LangfuseBacked.normalizeBackup(backup);
    const msg = (result["my-prompt"].labels["production"] as unknown as Record<string, unknown>[])[0];
    expect(msg["type"]).toBe("chatmessage");
  });

  it("text prompt not touched", () => {
    const backup: RawBackup = {
      "my-prompt": {
        type: "text",
        labels: { production: "some text" },
      },
    };
    const result = LangfuseBacked.normalizeBackup(backup);
    expect(result["my-prompt"].labels["production"]).toBe("some text");
  });

  it("mixed prompts: only chat normalized", () => {
    const backup: RawBackup = {
      "chat-prompt": {
        type: "chat",
        labels: {
          production: [{ role: "system", content: "Hi", type: "message" }],
        },
      },
      "text-prompt": {
        type: "text",
        labels: { production: "raw text" },
      },
    };
    const result = LangfuseBacked.normalizeBackup(backup);
    const chatMsg = (result["chat-prompt"].labels["production"] as unknown as Record<string, unknown>[])[0];
    expect(chatMsg["type"]).toBe("chatmessage");
    expect(result["text-prompt"].labels["production"]).toBe("raw text");
  });
});
