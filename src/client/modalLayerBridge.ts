import "./modalLayerBridge.css";

const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
const MODAL_OPEN_DATASET_KEY = "dshWorkbenchModalOpen";

export function modalDialogIsOpen(
  root: Pick<Document, "querySelector">,
): boolean {
  return root.querySelector(MODAL_DIALOG_SELECTOR) !== null;
}

/**
 * Marks the document while a real modal dialog is mounted.
 *
 * dsh-better-sidebar intentionally portals its panels outside #root and
 * reserves layout space on #root. A host modal rendered inside #root cannot
 * otherwise cover that portal or reclaim the reserved right/bottom space.
 * The accompanying CSS temporarily neutralises only that external panel host;
 * its mounted state is preserved and returns as soon as the modal closes.
 */
export function installModalLayerCompatibilityBridge(
  doc: Document = document,
): () => void {
  const root = doc.documentElement;
  const sync = (): void => {
    root.toggleAttribute(
      `data-${MODAL_OPEN_DATASET_KEY.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      modalDialogIsOpen(doc),
    );
  };

  const Observer = doc.defaultView?.MutationObserver;
  const target = doc.body ?? root;
  const observer = Observer === undefined
    ? undefined
    : new Observer(sync);

  observer?.observe(target, { childList: true, subtree: true });
  sync();

  return () => {
    observer?.disconnect();
    delete root.dataset[MODAL_OPEN_DATASET_KEY];
  };
}
