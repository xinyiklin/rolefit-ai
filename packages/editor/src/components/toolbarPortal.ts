const TOOLBAR_PORTAL_SELECTOR = "[data-typeset-toolbar-portal]";

// Toolbar menus portal to <body> to escape clipping ancestors, so an event inside
// one belongs to the control that opened it, not to "outside" any surface.
export function isInsideToolbarPortal(target: EventTarget | null): boolean {
  return Boolean((target as Partial<Element> | null)?.closest?.(TOOLBAR_PORTAL_SELECTOR));
}
