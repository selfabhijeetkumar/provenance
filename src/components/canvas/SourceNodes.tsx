"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEvidenceStore, type SourceNode } from "@/lib/store";

export function SourceNodes() {
  const nodes = useEvidenceStore((s) => s.nodes);
  const selectNode = useEvidenceStore((s) => s.selectNode);
  const selectedNode = useEvidenceStore((s) => s.selectedNode);

  if (!nodes || nodes.length === 0) return null;

  return (
    <group>
      {nodes.map((node) => (
        <SourceNodeItem
          key={node.id}
          node={node}
          isSelected={selectedNode?.id === node.id}
          onSelect={() => selectNode(node)}
        />
      ))}
    </group>
  );
}

function SourceNodeItem({
  node,
  isSelected,
  onSelect,
}: {
  node: SourceNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Animate node based on status
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();

    if (node.status === "unsupported") {
      // High-frequency jitter & red flicker
      const jitter = (Math.random() - 0.5) * 0.04;
      groupRef.current.position.x = node.position[0] + jitter;
      groupRef.current.position.y = node.position[1] + jitter;
      groupRef.current.position.z = node.position[2] + jitter;
    } else if (node.status === "verified") {
      // Steady gentle lock
      groupRef.current.position.x = node.position[0];
      groupRef.current.position.y = node.position[1];
      groupRef.current.position.z = node.position[2];
      groupRef.current.rotation.y += 0.01;
    } else {
      // Gentle breathing float
      groupRef.current.position.x = node.position[0];
      groupRef.current.position.y = node.position[1] + Math.sin(t * 1.5 + node.position[0]) * 0.08;
      groupRef.current.position.z = node.position[2];
    }
  });

  // State visuals
  let color = "#38bdf8";
  let ringSize = 0.35;
  let scale = isSelected ? 1.4 : hovered ? 1.25 : 1.0;

  if (node.status === "verified") {
    color = "#d4af37"; // warm gold
  } else if (node.status === "weak") {
    color = "#f59e0b"; // amber
  } else if (node.status === "unsupported") {
    color = "#ef4444"; // red
  }

  return (
    <group
      ref={groupRef}
      position={node.position}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Node Geometry varies by status for accessibility (shape + color) */}
      {node.status === "verified" ? (
        // Gold Dodecahedron / Lock beacon
        <mesh>
          <dodecahedronGeometry args={[0.24, 0]} />
          <meshStandardMaterial
            color="#d4af37"
            emissive="#d4af37"
            emissiveIntensity={0.8}
            roughness={0.2}
          />
        </mesh>
      ) : node.status === "unsupported" ? (
        // Red Tetrahedral Spike
        <mesh>
          <tetrahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial
            color="#ef4444"
            emissive="#ef4444"
            emissiveIntensity={1.0}
            wireframe
          />
        </mesh>
      ) : node.status === "weak" ? (
        // Amber Octahedron
        <mesh>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={0.6}
          />
        </mesh>
      ) : (
        // Discovered Cyan Sphere
        <mesh>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#38bdf8"
            emissiveIntensity={0.4}
          />
        </mesh>
      )}

      {/* Orbiting Halo Ring */}
      <mesh rotation={[Math.PI / 3, 0, 0]}>
        <ringGeometry args={[ringSize, ringSize + 0.04, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isSelected ? 0.9 : hovered ? 0.7 : 0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Double Gold Ring for Verified Status */}
      {node.status === "verified" && (
        <mesh rotation={[-Math.PI / 4, 0, 0]}>
          <ringGeometry args={[ringSize + 0.08, ringSize + 0.11, 24]} />
          <meshBasicMaterial
            color="#d4af37"
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
