"use client";

import { useEffect, useState, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { CentralManuscript } from "./CentralManuscript";
import { HubMarkers } from "./HubMarkers";
import { SourceNodes } from "./SourceNodes";
import { ConnectionLines } from "./ConnectionLines";
import { ScanRing } from "./ScanRing";
import { CameraController } from "./CameraController";
import { useEvidenceStore } from "@/lib/store";

export function EvidenceGraphCanvas() {
  const [webGlSupported, setWebGlSupported] = useState(true);
  const lowComplexity = useEvidenceStore((s) => s.lowComplexity);
  const toggleLowComplexity = useEvidenceStore((s) => s.toggleLowComplexity);

  useEffect(() => {
    // Check WebGL availability
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) setWebGlSupported(false);
    } catch {
      setWebGlSupported(false);
    }

    // Auto-detect low-complexity mode
    if (
      typeof navigator !== "undefined" &&
      ((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      if (!lowComplexity) {
        toggleLowComplexity();
      }
    }
  }, []);

  if (!webGlSupported) {
    return <Fallback2DView />;
  }

  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [0, 0, 11], fov: 45 }}
        dpr={[1, Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1.5)]}
        gl={{
          antialias: !lowComplexity,
          alpha: true,
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={["#030305"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 15, 10]} intensity={1.2} />
        <pointLight position={[0, 0, 5]} intensity={0.8} color="#d4af37" />

        <Suspense fallback={null}>
          <CameraController />
          <CentralManuscript />
          <HubMarkers />
          <SourceNodes />
          <ConnectionLines />
          <ScanRing />
        </Suspense>
      </Canvas>
    </div>
  );
}

function Fallback2DView() {
  const nodes = useEvidenceStore((s) => s.nodes);
  const selectNode = useEvidenceStore((s) => s.selectNode);

  return (
    <div className="fallback-2d-container">
      <div className="fallback-2d-header">
        <span>2D Evidence Network (WebGL Fallback)</span>
        <span className="badge badge-verified">{nodes.length} Sources Harvested</span>
      </div>
      <div className="fallback-2d-grid">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`fallback-node-card node-${node.status}`}
            onClick={() => selectNode(node)}
          >
            <div className="node-id">[{node.id}]</div>
            <div className="node-title">{node.title}</div>
            <div className="node-status-tag">{node.status.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default EvidenceGraphCanvas;
