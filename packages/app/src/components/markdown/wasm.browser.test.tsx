import { cleanup, render } from "@testing-library/react";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { afterEach, expect, it } from "vitest";

const flags = { latexMath: false };

afterEach(cleanup);

it("renders semantic Markdown through the published library's real browser WASM parser", async () => {
  const view = render(
    <EnrichedMarkdownText
      markdown={"# Browser WASM\n\n**Strong text** and `real_code`."}
      md4cFlags={flags}
    />,
  );
  await expect.poll(() => view.queryByRole("heading", { name: "Browser WASM" })).not.toBeNull();
  expect(view.container.querySelector("strong")?.textContent).toBe("Strong text");
  expect(view.container.querySelector("code")?.textContent).toBe("real_code");
});
