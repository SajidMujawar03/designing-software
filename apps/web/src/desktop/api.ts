/**
 * The desktop app's bridge, exposed by its preload script as `window.desktop`
 * (absent in a normal browser). Kept free of imports: the desktop package
 * uses this file for its side of the contract too.
 */

/** Which kind of window this is: files kept in the app, or a server's files. */
export type DesktopRole = 'offline' | 'cloud';

export interface DesktopSettings {
  /** The server cloud windows open (e.g. https://design.example.com); empty until set. */
  serverUrl: string;
}

export interface DesktopBridge {
  readonly platform: 'win32' | 'darwin' | 'linux' | string;
  readonly version: string;
  readonly role: DesktopRole;
  getSettings(): Promise<DesktopSettings>;
  /** Checks and saves the server address, then opens it in a cloud window. Rejects with a message if it's not usable. */
  connectServer(url: string): Promise<void>;
  /** Opens the saved server in a cloud window (or focuses one). */
  openCloud(): Promise<void>;
  /** Opens the start screen in a new window. */
  newWindow(): Promise<void>;
}
