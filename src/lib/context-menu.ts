
/** Disable WebView context menus in production only. */
export function disableContextMenu(
    target: Pick<Document, "addEventListener" | "removeEventListener">,
) {
  if (!import.meta.env.PROD) return () => {};

  const preventMenu = (event: MouseEvent) => event.preventDefault();

  target.addEventListener("contextmenu", preventMenu, true);

  return () => target.removeEventListener("contextmenu", preventMenu, true);
}
