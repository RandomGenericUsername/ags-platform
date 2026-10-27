/**
 * The bar's `Theme` adapter (spine AD-13; doc 101 §4 named no port, §11 named
 * the seam).
 *
 * The pure port + core live in `../ports/theme`; this file supplies the
 * display. The palette owns ONE dedicated `Gtk.CssProvider` per app: each
 * refresh creates and adds the next provider, THEN removes the previous one.
 * That is the documented contract (`docs/ags-restart-vs-live-theme-refresh.md`
 * §9-24) and the original dedicated implementation (`dotfiles-v3` 512cd5f9).
 *
 * WHY NOT THE AGS APP HELPER. Its CSS entry point creates, adds and retains a
 * provider on every call, so routing palette refreshes through it accumulated
 * one provider per refresh (BUG-001). Here the adapter removes only the handle
 * it added itself, so the app stylesheet installed at app start and the GTK
 * theme are never touched.
 *
 * THE PATH IS THE STABLE POINTER. `colors.css` is the provisioning-owned symlink
 * the runtime repoints at the current `colors.gtk.css` generation. Applying the
 * generation path directly would cache it, so a palette swap after
 * `wallpaper.state` would leave the bar stale (review F9). The stable pointer is
 * always current.
 */

import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import {
  createReplacingCssSink,
  createTheme,
  type CssProviderHandle,
  type CssProviderHost,
} from "../ports/theme";

//: The stable palette artifact: colors.css -> current/colors.gtk.css.
const PALETTE_CSS = `${GLib.get_user_config_dir()}/ags/colors.css`;

/**
 * Resolve the display lazily: importing this module must not require a live
 * display before `app.start()` has run.
 */
function defaultDisplay(): Gdk.Display {
  const display = Gdk.Display.get_default();
  if (display === null) throw new Error("no default GDK display");
  return display;
}

const gtkProviderHost: CssProviderHost = {
  add(path: string): Gtk.CssProvider {
    const provider = new Gtk.CssProvider();
    provider.load_from_path(path);
    Gtk.StyleContext.add_provider_for_display(
      defaultDisplay(),
      provider,
      Gtk.STYLE_PROVIDER_PRIORITY_USER,
    );
    return provider;
  },
  remove(provider: CssProviderHandle): void {
    Gtk.StyleContext.remove_provider_for_display(
      defaultDisplay(),
      provider as Gtk.CssProvider,
    );
  },
};

//: The bar's one Theme; app.tsx calls `theme.apply()` in main().
export const theme = createTheme(PALETTE_CSS, createReplacingCssSink(gtkProviderHost));
