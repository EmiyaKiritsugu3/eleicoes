import React from "react";
import SourceBadge from "./SourceBadge";
import { FixtureSeal } from "./FixtureBadge";
import type { SealState } from "../lib/data";

/** Slot único de selo p/ /, /analisar e /auditoria: oficial via
 *  `getOfficialAuditInfo` (dentro de `getSealState`); fixture
 *  (`fixture:true`) usa FixtureSeal com hash cheio — nunca SourceBadge.
 */
export default function SealSlot({ seal }: { seal: SealState }) {
  if (seal.official) {
    const o = seal.official;
    return <SourceBadge hash={o.hash} url={o.url} date={o.date} />;
  }
  if (seal.hasFixture) {
    return <FixtureSeal hash={seal.fixtureHash} />;
  }
  return <SourceBadge hash="" url="" date="" />;
}
