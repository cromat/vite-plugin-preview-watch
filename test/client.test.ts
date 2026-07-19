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
    const script = renderClientScript("/__preview_watch", "auto");
    expect(script).toContain(`new EventSource("/__preview_watch")`);
    expect(script).toContain(`"reload"`);
    expect(script).toContain("location.reload()");
    expect(script.startsWith("<script")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
  });

  it("handles a build-error event with a distinct event name", () => {
    const script = renderClientScript("/__preview_watch", "auto");
    expect(script).toContain(`"build-error"`);
    // Must not listen on EventSource's built-in "error" event.
    expect(script).not.toContain(`addEventListener("error"`);
    expect(script).toContain("data-vite-preview-watch-error");
    // Uses textContent (not innerHTML) so build output cannot inject markup.
    expect(script).toContain("textContent");
    expect(script).not.toContain("innerHTML");
  });

  it("JSON-encodes the url so quotes cannot break out of the string", () => {
    const script = renderClientScript('/a"b', "auto");
    expect(script).toContain('new EventSource("/a\\"b")');
  });

  it("includes manual=false for auto mode", () => {
    const script = renderClientScript("/__preview_watch", "auto");
    expect(script).toContain("manual=false");
  });

  it("includes manual=true for manual mode", () => {
    const script = renderClientScript("/__preview_watch", "manual");
    expect(script).toContain("manual=true");
  });

  it("includes data-vite-preview-watch-toast attribute", () => {
    const script = renderClientScript("/__preview_watch", "auto");
    expect(script).toContain("data-vite-preview-watch-toast");
  });

  it("includes addEventListener for open event", () => {
    const script = renderClientScript("/__preview_watch", "auto");
    expect(script).toContain(`addEventListener("open"`);
  });
});
