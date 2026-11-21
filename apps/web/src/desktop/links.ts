/** A link that opens a cloud file of this server in the desktop app (design-clone://). */
export const desktopLink = (fileId: string, server = location.origin) =>
  `design-clone://file/${encodeURIComponent(fileId)}?server=${encodeURIComponent(server)}`;
