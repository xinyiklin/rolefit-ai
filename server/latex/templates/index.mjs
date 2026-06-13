// Template registry. Add new renderers here.

import jakes from "./jakes.mjs";

const TEMPLATES = [jakes];

export function listTemplates() {
  return TEMPLATES.map(({ id, name, description, source }) => ({ id, name, description, source }));
}

export function getTemplate(id) {
  return TEMPLATES.find((tpl) => tpl.id === id) ?? null;
}

export const defaultTemplateId = "jakes";
