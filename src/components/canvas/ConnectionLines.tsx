"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useEvidenceStore } from "@/lib/store";

export function ConnectionLines() {
  const beams = useEvidenceStore((s) => s.beams);
  const lowComplexity = useEvidenceStore((s) => s.lowComplexity);

  // Group beams by type for batch line rendering
  const { hubGeometry, claimGeometry, linkGeometry } = useMemo(() => {
    const hubPoints: THREE.Vector3[] = [];
    const claimPoints: THREE.Vector3[] = [];
    const linkPoints: THREE.Vector3[] = [];

    beams.forEach((beam) => {
      const from = new THREE.Vector3(...beam.from);
      const to = new THREE.Vector3(...beam.to);
      if (beam.type === "hub") {
        hubPoints.push(from, to);
      } else if (beam.type === "claim") {
        claimPoints.push(from, to);
      } else if (beam.type === "link" && !lowComplexity) {
        linkPoints.push(from, to);
      }
    });

    const hGeo = new THREE.BufferGeometry().setFromPoints(hubPoints);
    const cGeo = new THREE.BufferGeometry().setFromPoints(claimPoints);
    const lGeo = new THREE.BufferGeometry().setFromPoints(linkPoints);

    return {
      hubGeometry: hGeo,
      claimGeometry: cGeo,
      linkGeometry: lGeo,
    };
  }, [beams, lowComplexity]);

  if (!beams || beams.length === 0) return null;

  return (
    <group>
      {/* Hub Streams (sub-question links) */}
      <lineSegments geometry={hubGeometry}>
        <lineBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.25}
        />
      </lineSegments>

      {/* Inter-source Links (Gatherer) */}
      {!lowComplexity && (
        <lineSegments geometry={linkGeometry}>
          <lineBasicMaterial
            color="#d4af37"
            transparent
            opacity={0.2}
          />
        </lineSegments>
      )}

      {/* Writer Claim Beams (Manuscript -> Cited Sources) */}
      <lineSegments geometry={claimGeometry}>
        <lineBasicMaterial
          color="#a855f7"
          transparent
          opacity={0.65}
          linewidth={2}
        />
      </lineSegments>
    </group>
  );
}
