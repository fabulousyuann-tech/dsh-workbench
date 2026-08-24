const PANEL_HOST_SELECTOR = "[data-dsh-panel-host]";
const FILE_UPLOAD_MARKER_SELECTOR =
  'style[data-plugin="dsh-file-upload"], .dsh-upload-overlay, button.dsh-upload-btn';
const SIDEBAR_FILE_OWNER_SELECTOR = [
  '[data-dsh-file-drop-owner="workspace"]',
  '[class*="_explorer"]',
  '[class*="_uploadDropZone"]',
].join(",");

const FILE_DRAG_EVENTS = ["dragenter", "dragover", "dragleave", "drop"] as const;

type FileDragEventName = (typeof FILE_DRAG_EVENTS)[number];

interface ClosestTarget extends EventTarget {
  closest: (selector: string) => Element | null;
}
function closestTarget(target: EventTarget | null): ClosestTarget | undefined {
  if (target === null || typeof (target as Partial<ClosestTarget>).closest !== "function") {
    return undefined;
  }
  return target as ClosestTarget;
}

export function dragCarriesFiles(event: Pick<DragEvent, "dataTransfer">): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * dsh-better-sidebar owns file drops inside its explorer. Other parts of its
 * viewport-sized panel host currently stop the event before document-level
 * chat upload listeners can see it, so only those non-explorer targets need a
 * compatibility relay.
 */
export function shouldBridgeFileDragTarget(target: EventTarget | null): boolean {
  const element = closestTarget(target);
  if (element === undefined || element.closest(PANEL_HOST_SELECTOR) === null) return false;
  return element.closest(SIDEBAR_FILE_OWNER_SELECTOR) === null;
}

function relayedDragEvent(event: DragEvent): DragEvent {
  return new DragEvent(event.type, {
    bubbles: false,
    cancelable: true,
    composed: false,
    dataTransfer: event.dataTransfer,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  });
}

/**
 * Bridges only file drags that fail to reach document bubble listeners.
 *
 * The capture listener records a candidate and the document bubble listener
 * clears it when normal propagation succeeds. A microtask relays only the
 * candidates that remain, which makes the bridge a no-op if a future
 * dsh-better-sidebar release removes its propagation shield. Relayed events
 * are marked to prevent recursion.
 */
export function installFileDropCompatibilityBridge(doc: Document = document): () => void {
  const pending = new WeakSet<DragEvent>();
  const relayed = new WeakSet<DragEvent>();
  let disposed = false;

  const onCapture = (rawEvent: Event): void => {
    const event = rawEvent as DragEvent;
    if (
      relayed.has(event)
      || !dragCarriesFiles(event)
      || !shouldBridgeFileDragTarget(event.target)
    ) {
      return;
    }

    pending.add(event);
    queueMicrotask(() => {
      if (disposed || !pending.delete(event)) return;
      if (doc.querySelector(FILE_UPLOAD_MARKER_SELECTOR) === null) return;

      try {
        const relay = relayedDragEvent(event);
        relayed.add(relay);
        const accepted = !doc.dispatchEvent(relay);
        if (accepted) event.preventDefault();
      } catch {
        // Browser security policies may reject a reused DataTransfer. In that
        // case leave the upstream sidebar behavior untouched instead of
        // breaking drag-and-drop across the app.
      }
    });
  };

  const onBubble = (rawEvent: Event): void => {
    pending.delete(rawEvent as DragEvent);
  };

  for (const name of FILE_DRAG_EVENTS) {
    doc.addEventListener(name, onCapture, true);
    doc.addEventListener(name, onBubble, false);
  }
  doc.documentElement.dataset.dshWorkbenchFileDropBridge = "ready";

  return () => {
    disposed = true;
    for (const name of FILE_DRAG_EVENTS) {
      doc.removeEventListener(name, onCapture, true);
      doc.removeEventListener(name, onBubble, false);
    }
    delete doc.documentElement.dataset.dshWorkbenchFileDropBridge;
  };
}
