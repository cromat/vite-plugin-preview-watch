import { describe, expect, it } from "vitest";
import { joinClientUrl, renderClientScript } from "../src/client";

describe("joinClientUrl", () => {
  it("joins root base without a double slash", () => {
    expect(joinClientUrl("/", "/__preview_watch")).toBe("/__preview_watch");
  });

  it("joins a non-root base", () => {
    expect(joinClientUrl("/app/", "/__preview_watch")).toBe(
      "/app/__preview_watch",
    );
  });
});

describe("renderClientScript", () => {
  it("embeds the url and reloads on the reload event", () => {
    const script = renderClientScript("/__preview_watch");
    expect(script).toContain(`new EventSource("/__preview_watch")`);
    expect(script).toContain(`"reload"`);
    expect(script).toContain("location.reload()");
    expect(script.startsWith("<script")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
  });

  it("JSON-encodes the url so quotes cannot break out of the string", () => {
    const script = renderClientScript('/a"b');
    expect(script).toContain('new EventSource("/a\\"b")');
  });
});
