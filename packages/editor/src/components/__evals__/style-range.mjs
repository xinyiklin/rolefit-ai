import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import React from "react";
import ts from "typescript";

const sourceUrl = new URL("../toolbar/StyleRange.tsx", import.meta.url);
const source = readFileSync(sourceUrl, "utf8").replace(
  "export function StyleRange",
  "function StyleRange"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const StyleRange = Function("React", `${compiled}\nreturn StyleRange;`)(React);

const rendered = StyleRange({
  id: "header-gap",
  label: "Header gap",
  value: 4,
  min: 0,
  max: 12,
  step: 0.1,
  displayValue: "4 pt",
  disabled: true,
  onChange() {
    throw new Error("a disabled slider must not emit changes");
  }
});
const input = React.Children.toArray(rendered.props.children).find(
  (child) => child?.type === "input"
);
assert.equal(input?.props.disabled, true, "the native range input receives the host disabled state");

console.log("editor component probes: PASS");
