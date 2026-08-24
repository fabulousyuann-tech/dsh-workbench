import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const clientUrl = new URL(
  "../plugins/dsh-file-upload-yuan/lib/client.js",
  import.meta.url,
);
const uploadUrl = new URL(
  "../plugins/dsh-file-upload-yuan/lib/upload.js",
  import.meta.url,
);

describe("dsh-file-upload local compatibility build", () => {
  it("notifies the attachment dock after successful uploads", async () => {
    const client = await readFile(clientUrl, "utf8");
    expect(client).toContain("function notifyUploadMetaChanged()");
    expect(client).toContain("subscribeUploadMeta(() =>");
    expect(client).toContain("listener(uploadError)");
  });

  it("round-trips Unicode attachment paths through HTTP headers", async () => {
    const client = await readFile(clientUrl, "utf8");
    const upload = await readFile(uploadUrl, "utf8");
    expect(client).toContain('\"x-file-path\": encodeURIComponent(ref)');
    expect(upload).toContain("filePath = decodeURIComponent(filePath)");
  });
});
