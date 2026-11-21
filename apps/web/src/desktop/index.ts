import type { DesktopBridge } from './api';

/** The desktop app's bridge, when running in it (undefined in a browser). */
export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop;

/** An offline desktop window: the start screen replaces the dashboard, and there is no server. */
export const isDesktopOffline = desktop?.role === 'offline';
