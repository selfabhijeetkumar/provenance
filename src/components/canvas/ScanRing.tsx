"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEvidenceStore } from "@/lib/store";

export function ScanRing() {
  const scanSweep = useEvidenceStore((s) => s.scanSweep);
  const ringRef = useRef<THREE.Mesh>(null);
  const progressRef = useRef(0);

  useFrame((_, delta) => {
    if (!ringRef.current) return;
    if (scanSweep) {
      progressRef.current = (progressRef.current + delta * 0.5) % 1;
      const radius = progressRef.current * 18;
      ringRef.current.scale.set(radius, radius, 1);
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = Math.max(0, 1 - progressRef.current) * 0.6;
      }
    }
  });

  if (!scanSweep) return null;

  return (
    <mesh ref={ringRef} position={[0, 0, 0]}>
      <ringGeometry args={[0.95, 1.0, 64]} />
      <meshBasicMaterial
        color="#d4af37"
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
