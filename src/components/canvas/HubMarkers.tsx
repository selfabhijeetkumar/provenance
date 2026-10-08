"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEvidenceStore, type HubNode } from "@/lib/store";

export function HubMarkers() {
  const hubs = useEvidenceStore((s) => s.hubs);

  if (!hubs || hubs.length === 0) return null;

  return (
    <group>
      {hubs.map((hub) => (
        <HubMarkerItem key={hub.index} hub={hub} />
      ))}
    </group>
  );
}

function HubMarkerItem({ hub }: { hub: HubNode }) {
  const meshRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * 0.6;
    meshRef.current.rotation.x += delta * 0.3;
  });

  const isDegraded = hub.status === "degraded";
  const color = isDegraded ? "#f59e0b" : "#38bdf8";

  return (
    <group position={hub.position}>
      {/* Rotating Diamond/Octahedron */}
      <group ref={meshRef}>
        <mesh>
          <octahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={isDegraded ? 0.3 : 0.8}
            wireframe
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.25, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>

      {/* Orbiting Ground Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.75, 0.82, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isDegraded ? 0.2 : 0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
