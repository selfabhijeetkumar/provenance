"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEvidenceStore } from "@/lib/store";

export function CentralManuscript() {
  const meshRef = useRef<THREE.Group>(null);
  const stage = useEvidenceStore((s) => s.stage);
  const claimCount = useEvidenceStore((s) => s.claimCount);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();

    // Subtle breathing / bobbing
    meshRef.current.position.y = Math.sin(t * 1.2) * 0.2;

    if (stage === "idle") {
      meshRef.current.rotation.y += delta * 0.4;
      meshRef.current.rotation.x = Math.sin(t * 0.6) * 0.08;
    } else {
      // In running/done state, face forward with gentle tilt
      meshRef.current.rotation.y = THREE.MathUtils.lerp(
        meshRef.current.rotation.y,
        Math.sin(t * 0.4) * 0.15,
        0.05
      );
      meshRef.current.rotation.x = THREE.MathUtils.lerp(
        meshRef.current.rotation.x,
        0.05,
        0.05
      );
    }
  });

  const isDone = stage === "done";

  return (
    <group ref={meshRef} position={[0, 0, 0]}>
      {/* Outer Glow Halo */}
      <mesh>
        <planeGeometry args={[3.2, 4.4]} />
        <meshBasicMaterial
          color={isDone ? "#d4af37" : "#6366f1"}
          transparent
          opacity={isDone ? 0.2 : 0.08}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Main Manuscript Slab */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.2, 3.2, 0.12]} />
        <meshStandardMaterial
          color="#09090f"
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* Gold/Indigo Border Inset */}
      <mesh position={[0, 0, 0.07]}>
        <ringGeometry args={[1.3, 1.34, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial
          color={isDone ? "#d4af37" : "#818cf8"}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Procedural Header Rule */}
      <mesh position={[0, 0.9, 0.07]}>
        <planeGeometry args={[1.6, 0.04]} />
        <meshBasicMaterial color={isDone ? "#d4af37" : "#94a3b8"} />
      </mesh>

      {/* Procedural Text Lines */}
      {[-0.4, -0.1, 0.2, 0.5].map((y, i) => (
        <mesh key={i} position={[0, -y, 0.07]}>
          <planeGeometry args={[1.4 - (i % 2) * 0.3, 0.025]} />
          <meshBasicMaterial
            color="#475569"
            transparent
            opacity={0.6}
          />
        </mesh>
      ))}

      {/* Idle Orbiting Citation Nodes */}
      {stage === "idle" && (
        <group>
          {[0, 1, 2, 3].map((idx) => (
            <OrbitParticle key={idx} index={idx} total={4} />
          ))}
        </group>
      )}

      {/* Center Seal Ring */}
      <mesh position={[0, -1.0, 0.07]}>
        <circleGeometry args={[0.22, 32]} />
        <meshStandardMaterial
          color={isDone ? "#d4af37" : "#3b82f6"}
          emissive={isDone ? "#d4af37" : "#3b82f6"}
          emissiveIntensity={0.6}
        />
      </mesh>
    </group>
  );
}

function OrbitParticle({ index, total }: { index: number; total: number }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() * 0.8 + (index * (Math.PI * 2)) / total;
    const r = 2.4;
    ref.current.position.x = Math.cos(t) * r;
    ref.current.position.z = Math.sin(t) * r * 0.6;
    ref.current.position.y = Math.sin(t * 1.5) * 0.5;
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.07, 16, 16]} />
      <meshBasicMaterial color="#d4af37" />
    </mesh>
  );
}
