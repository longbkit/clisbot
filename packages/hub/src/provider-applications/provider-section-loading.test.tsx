import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { PROVIDER_GUIDES } from "./guides.js";
import { ProviderSectionLoading } from "./provider-section.js";

function loadingMarkup(): string {
  return renderToStaticMarkup(
    <div>
      {PROVIDER_GUIDES.map((guide) => (
        <ProviderSectionLoading key={guide.provider} guide={guide} open={false} />
      ))}
    </div>,
  );
}

describe("provider application loading surface", () => {
  it("offers the three choices and nothing else", () => {
    const markup = loadingMarkup();

    for (const name of ["GitHub", "Slack", "Discord"]) assert.match(markup, new RegExp(name, "u"));
    assert.match(markup, /aria-busy="true"/u);
    for (const header of PROVIDER_GUIDES) {
      assert.ok(markup.includes(header.summary.slice(0, 20)), `${header.name} lost its sub-line`);
    }
  });

  it("opens no provider on its own, so nothing has to be closed before the choice is made", () => {
    const markup = loadingMarkup();

    assert.doesNotMatch(markup, /aria-expanded="true"/u);
    assert.equal(markup.match(/aria-expanded="false"/gu)?.length, PROVIDER_GUIDES.length);
    // Instructions belong to a section someone opened, never to the first paint.
    assert.doesNotMatch(markup, /Create a GitHub App/u);
    assert.doesNotMatch(markup, /Create a Slack app/u);
    assert.doesNotMatch(markup, /App manifest/u);
  });
});
