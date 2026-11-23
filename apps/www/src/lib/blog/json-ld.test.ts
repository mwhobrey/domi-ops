import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./json-ld";

describe("serializeJsonLd", () => {
  it("escapes < so a description cannot close the script tag", () => {
    const html = serializeJsonLd({ description: "What does </script> mean?" });
    expect(html).not.toContain("</script>");
    expect(html).toContain("\\u003c/script>");
    expect(JSON.parse(html).description).toBe("What does </script> mean?");
  });
});
