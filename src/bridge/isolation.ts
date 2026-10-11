import { isDisabledCollaboration } from "./browser.js";

/** Non-secret off sentinel prevents upstream's unconditional credential mint. */
export function prepareIsolatedDocument<T extends object>(
  doc: T,
): T & { collab: { room: string; key: string; on: false } } {
  const current = (doc as { collab?: unknown }).collab;
  if (current && !isDisabledCollaboration(current)) {
    throw new Error("BENTO_COLLAB_DISABLED: refuse a collaborative input");
  }
  return { ...structuredClone(doc), collab: { room: "", key: "", on: false } };
}

/** Insert before all upstream executable scripts, including in standalone HTML.
 * The upstream pristine-shell capture therefore retains this adapter on Save.
 * This changes capabilities in this document's realm, never the browser profile.
 */
export const ISOLATION_MARKER = "qbento-isolated-host-v1";
export const ISOLATION_BOOTSTRAP = String.raw`(() => {
  'use strict';
  if (globalThis.__qbentoIsolatedHost) return;
  Object.defineProperty(globalThis, '__qbentoIsolatedHost', {value: 'qbento-isolated-host-v1'});
  // Upstream has no collaboration-off hook and always constructs this channel.
  class IsolatedChannel extends EventTarget {
    constructor(name) { super(); this.name = String(name); this.onmessage = null; this.onmessageerror = null; }
    postMessage() {} close() {}
  }
  Object.defineProperty(globalThis, 'BroadcastChannel', {value:IsolatedChannel, configurable:false, writable:false});
  // The project journal, not stale same-docId browser recovery, owns Studio state.
  Object.defineProperty(globalThis, 'indexedDB', {value:undefined, configurable:false, writable:false});
  class DisabledSocket { constructor() { throw new Error('QBENTO_COLLAB_DISABLED: live sharing unavailable'); } }
  Object.defineProperty(globalThis, 'WebSocket', {value:DisabledSocket, configurable:false, writable:false});
  // The UI must not offer a disabled transport. Native local HTML Save still works.
  const disableShare = () => {
    document.querySelectorAll('.ed-btn-share').forEach(button => {
      button.disabled = true;
      button.title = 'Live sharing is unavailable in Quarto-Bento';
      button.setAttribute('aria-disabled', 'true');
    });
  };
  new MutationObserver(disableShare).observe(document.documentElement, {childList:true, subtree:true});
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.ed-btn-share,.ed-share-pop')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  disableShare();
})();`;

/** Offline shell policy. Host Studio persistence is same-origin HTTP only.
 * Place this meta CSP before upstream styles/scripts, and preferably also send
 * as an HTTP response header. No remote fonts/assets/widgets or relay sockets.
 */
export const OFFLINE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'self' blob:; style-src 'unsafe-inline' 'self'; img-src data: blob: 'self'; font-src data: blob: 'self'; media-src data: blob: 'self'; connect-src 'self'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
