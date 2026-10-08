"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { useEvidenceStore } from "@/lib/store";

export function CameraController() {
  const { camera } = useThree();
  const stage = useEvidenceStore((s) => s.stage);
  const targetCamera = useEvidenceStore((s) => s.targetCamera);
  const isAnimatingRef = useRef(false);

  // Stage camera transitions
  useEffect(() => {
    let destPos: [number, number, number] = [0, 0, 11];

    if (stage === "running") {
      destPos = [0, 1.5, 18];
    } else if (stage === "done") {
      destPos = [3, 0.8, 16];
    }

    isAnimatingRef.current = true;
    gsap.to(camera.position, {
      x: destPos[0],
      y: destPos[1],
      z: destPos[2],
      duration: 1.8,
      ease: "power3.inOut",
      onComplete: () => {
        isAnimatingRef.current = false;
      },
    });
  }, [stage, camera]);

  // Target camera transitions (when clicking a node/citation)
  useEffect(() => {
    if (!targetCamera) return;

    isAnimatingRef.current = true;
    gsap.to(camera.position, {
      x: targetCamera[0],
      y: targetCamera[1],
      z: targetCamera[2],
      duration: 1.2,
      ease: "power2.out",
      onComplete: () => {
        isAnimatingRef.current = false;
      },
    });
  }, [targetCamera, camera]);

  // Gentle subtle camera drift when idle / steady
  useFrame(({ clock }) => {
    if (isAnimatingRef.current) return;
    const t = clock.getElapsedTime() * 0.3;
    camera.lookAt(0, 0, 0);
  });

  return null;
}
