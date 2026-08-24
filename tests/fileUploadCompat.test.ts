import { describe, expect, it } from "vitest";

import {
  dragCarriesFiles,
  shouldBridgeFileDragTarget,
} from "../src/client/fileDropBridge.js";

function dragEventWithTypes(types: string[]): Pick<DragEvent, "dataTransfer"> {
  return { dataTransfer: { types } as unknown as DataTransfer };
}

function closestTarget(options: {
  insidePanel: boolean;
  ownedBySidebar?: boolean;
}): EventTarget {
  return {
    closest(selector: string): Element | null {
      if (selector === "[data-dsh-panel-host]") {
        return options.insidePanel ? ({} as Element) : null;
      }
      return options.ownedBySidebar ? ({} as Element) : null;
    },
  } as unknown as EventTarget;
}

describe("file upload compatibility bridge", () => {
  it("relays only drags that contain files", () => {
    expect(dragCarriesFiles(dragEventWithTypes(["Files"]))).toBe(true);
    expect(dragCarriesFiles(dragEventWithTypes(["text/plain"]))).toBe(false);
    expect(dragCarriesFiles({ dataTransfer: null })).toBe(false);
  });

  it("leaves sidebar-owned and outside-panel drop targets untouched", () => {
    expect(
      shouldBridgeFileDragTarget(
        closestTarget({ insidePanel: true, ownedBySidebar: false }),
      ),
    ).toBe(true);
    expect(
      shouldBridgeFileDragTarget(
        closestTarget({ insidePanel: true, ownedBySidebar: true }),
      ),
    ).toBe(false);
    expect(
      shouldBridgeFileDragTarget(
        closestTarget({ insidePanel: false, ownedBySidebar: false }),
      ),
    ).toBe(false);
  });
});
