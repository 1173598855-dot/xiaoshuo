import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ThreeBookTurnDirection = "next" | "prev" | null;

interface ThreeBookModelProps {
  open: boolean;
  turnDirection: ThreeBookTurnDirection;
}

interface BookModel {
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  coverGroup: THREE.Group;
  turnGroup: THREE.Group;
  scene: THREE.Scene;
  coverRotation: number;
  turnRotation: number;
}

export function ThreeBookModel({ open, turnDirection }: ThreeBookModelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<BookModel | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
      canvas.hidden = true;
      root.dataset.webgl = "unsupported";
      return;
    }

    let model: BookModel | null = null;
    let resizeObserver: ResizeObserver | null = null;
    try {
      const webglContext = canvas.getContext("webgl2", { antialias: true, alpha: true }) ?? canvas.getContext("webgl", { antialias: true, alpha: true });
      if (!webglContext) {
        canvas.hidden = true;
        root.dataset.webgl = "unsupported";
        return;
      }
      const renderer = new THREE.WebGLRenderer({ canvas, context: webglContext as WebGLRenderingContext, alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(0.12, 0.05, 6.1);
      camera.lookAt(0, 0, 0);

      scene.add(new THREE.HemisphereLight(0xe8e3ff, 0x0b0911, 1.35));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(-3.5, 4.5, 5);
      scene.add(keyLight);
      const purpleLight = new THREE.PointLight(0x8d7bff, 1.3, 8);
      purpleLight.position.set(2.4, 1.4, 3.2);
      scene.add(purpleLight);

      const book = new THREE.Group();
      book.rotation.set(-0.04, -0.16, 0);
      scene.add(book);

      const pageMaterial = new THREE.MeshStandardMaterial({ color: 0x756d80, roughness: 0.78, metalness: 0.02 });
      const paperEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0xbcb5c8, roughness: 0.9, metalness: 0 });
      const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2445, roughness: 0.54, metalness: 0.14 });
      const spineMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3b78, roughness: 0.6, metalness: 0.18 });

      const pageBlock = new THREE.Mesh(new THREE.BoxGeometry(3.35, 2.16, 0.16), paperEdgeMaterial);
      book.add(pageBlock);
      const innerPage = new THREE.Mesh(new THREE.BoxGeometry(3.27, 2.08, 0.04), pageMaterial);
      innerPage.position.z = 0.11;
      book.add(innerPage);

      const backCover = new THREE.Mesh(new THREE.BoxGeometry(3.52, 2.32, 0.1), coverMaterial);
      backCover.position.z = -0.16;
      book.add(backCover);

      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.34, 0.34), spineMaterial);
      spine.position.x = -1.7;
      spine.position.z = 0.02;
      book.add(spine);

      const coverGroup = new THREE.Group();
      coverGroup.position.set(-1.72, 0, 0.21);
      const frontCover = new THREE.Mesh(new THREE.BoxGeometry(3.52, 2.32, 0.1), coverMaterial);
      frontCover.position.x = 1.76;
      coverGroup.add(frontCover);
      book.add(coverGroup);

      const turnGroup = new THREE.Group();
      turnGroup.position.set(-1.69, 0, 0.275);
      const turningPage = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.12, 0.035), paperEdgeMaterial);
      turningPage.position.x = 1.65;
      turnGroup.add(turningPage);
      book.add(turnGroup);

      model = { camera, renderer, coverGroup, turnGroup, scene, coverRotation: 0, turnRotation: 0 };
      modelRef.current = model;

      const resize = () => {
        if (!model) return;
        const rect = root.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      resize();
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(root);
      } else {
        window.addEventListener("resize", resize);
      }

      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener("resize", resize);
        pageBlock.geometry.dispose();
        innerPage.geometry.dispose();
        backCover.geometry.dispose();
        spine.geometry.dispose();
        frontCover.geometry.dispose();
        turningPage.geometry.dispose();
        pageMaterial.dispose();
        paperEdgeMaterial.dispose();
        coverMaterial.dispose();
        spineMaterial.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        modelRef.current = null;
      };
    } catch {
      canvas.hidden = true;
      root.dataset.webgl = "unsupported";
    }
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coverTarget = open ? -Math.PI * 0.92 : 0;
    const turnTarget = turnDirection === "next" ? -Math.PI : turnDirection === "prev" ? Math.PI : 0;
    if (reducedMotion) {
      model.coverRotation = coverTarget;
      model.turnRotation = turnTarget;
      model.coverGroup.rotation.y = coverTarget;
      model.turnGroup.rotation.y = turnTarget;
      model.renderer.render(model.scene, model.camera);
      return;
    }

    const startedAt = performance.now();
    const fromCover = model.coverRotation;
    const fromTurn = model.turnRotation;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 360);
      const eased = 1 - Math.pow(1 - progress, 4);
      model.coverRotation = fromCover + (coverTarget - fromCover) * eased;
      model.turnRotation = fromTurn + (turnTarget - fromTurn) * eased;
      model.coverGroup.rotation.y = model.coverRotation;
      model.turnGroup.rotation.y = model.turnRotation;
      model.renderer.render(model.scene, model.camera);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, turnDirection]);

  return <div className="preset-book-3d-model" ref={rootRef} aria-hidden="true"><canvas ref={canvasRef} /></div>;
}
