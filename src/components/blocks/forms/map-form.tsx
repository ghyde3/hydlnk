"use client";

import { LIMITS, type MapBlock } from "@/lib/document";
import { CountedTextField } from "./counted-text-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/** The hint under the address: what visitors get from it. */
export const MAP_ADDRESS_HINT =
  "Visitors see this address and can open it in Google Maps or Apple Maps.";

/**
 * Map location (M9-22): a place name and an address, then the style group (Corner radius, Border
 * thickness and Border color). There is no map to place: the page shows an address card, and the
 * two buttons open the place in Google Maps and Apple Maps.
 */
export function MapForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "map") return null;
  const map: MapBlock = block;
  return (
    <div className="flex flex-col gap-3">
      <CountedTextField
        label="Place name"
        field="name"
        max={LIMITS.mapName}
        value={map.name}
        error={fieldError(errors, map.id, "name")}
        onChange={(name) => onChange({ ...map, name })}
      />
      <CountedTextField
        label="Address"
        field="address"
        max={LIMITS.mapAddress}
        value={map.address}
        error={fieldError(errors, map.id, "address")}
        hint={MAP_ADDRESS_HINT}
        onChange={(address) => onChange({ ...map, address })}
      />
      <OverrideControls block={map} onChange={onChange} errors={errors} />
    </div>
  );
}
