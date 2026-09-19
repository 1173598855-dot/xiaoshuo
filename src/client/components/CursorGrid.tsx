/**
 * Adapted from React Bits' CursorGrid component.
 * Source: https://github.com/DavidHDev/react-bits
 * License: MIT + Commons Clause; see docs/third-party/react-bits.md.
 *
 * The original component listens on its own surface. This adaptation listens
 * on the window so the canvas can stay behind the workbench without blocking
 * form controls or keyboard interaction.
 */
import { useEffect, useRef, type CSSProperties } from "react";

import "./CursorGrid.css";

type Falloff = "linear" | "smooth" | "sharp";

interface CursorGridProps {
  cellSize?: number;
  color?: string;
  radius?: number;
  falloff?: Falloff;
  holdTime?: number;
  fadeDuration?: number;
  lineWidth?: number;
  maxOpacity?: number;
  fillOpacity?: number;
  gridOpacity?: number;
  cellRadius?: number;
  clickPulse?: boolean;
  pulseSpeed?: number;
  className?: string;
  style?: CSSProperties;
}

interface GridConfig {
  cellSize: number;
  color: string;
  radius: number;
  falloff: Falloff;
  holdTime: number;
  fadeDuration: number;
  lineWidth: number;
  maxOpacity: number;
  fillOpacity: number;
  gridOpacity: number;
  cellRadius: number;
  clickPulse: boolean;
  pulseSpeed: number;
}

interface Pulse {
  x: number;
  y: number;
  t0: number;
}

interface DotState {
  alpha: number;
  touchedAt: number;
}

const FALL_OFF: Record<Falloff, (value: number) => number> = {
  linear: (value) => value,
  smooth: (value) => value * value * (3 - 2 * value),
  sharp: (value) => value * value * value,
};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((char) => `${char}${char}`).join("") : value;
  const parsed = Number.parseInt(normalized.slice(0, 6), 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

export function CursorGrid({
  cellSize = 64,
  color = "#63d6c6",
  radius = 180,
  falloff = "smooth",
  holdTime = 220,
  fadeDuration = 700,
  lineWidth = 1,
  maxOpacity = 0.9,
  fillOpacity = 0.04,
  gridOpacity = 0.025,
  cellRadius = 0,
  clickPulse = true,
  pulseSpeed = 620,
  className = "",
  style,
}: CursorGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const configRef = useRef<GridConfig>({
    cellSize,
    color,
    radius,
    falloff,
    holdTime,
    fadeDuration,
    lineWidth,
    maxOpacity,
    fillOpacity,
    gridOpacity,
    cellRadius,
    clickPulse,
    pulseSpeed,
  });
  const wakeRef = useRef<(() => void) | null>(null);

  configRef.current = {
    cellSize,
    color,
    radius,
    falloff,
    holdTime,
    fadeDuration,
    lineWidth,
    maxOpacity,
    fillOpacity,
    gridOpacity,
    cellRadius,
    clickPulse,
    pulseSpeed,
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;
    if (typeof ResizeObserver === "undefined") return undefined;
    if (typeof window.matchMedia === "function" && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    let columns = 0;
    let rows = 0;
    let offsetX = 0;
    let offsetY = 0;
    let width = 1;
    let height = 1;
    let states: DotState[] = [];
    let pulses: Pulse[] = [];
    let frameId = 0;
    let running = false;
    let previousFrame = 0;

    const rebuild = () => {
      const config = configRef.current;
      width = Math.max(container.clientWidth, 1);
      height = Math.max(container.clientHeight, 1);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      columns = Math.ceil(width / config.cellSize) + 1;
      rows = Math.ceil(height / config.cellSize) + 1;
      offsetX = (width - columns * config.cellSize) / 2;
      offsetY = (height - rows * config.cellSize) / 2;
      states = Array.from({ length: columns * rows }, () => ({ alpha: 0, touchedAt: 0 }));
    };

    const cellCenter = (index: number): [number, number] => {
      const config = configRef.current;
      return [
        offsetX + (index % columns) * config.cellSize + config.cellSize / 2,
        offsetY + Math.floor(index / columns) * config.cellSize + config.cellSize / 2,
      ];
    };

    const energize = (x: number, y: number, boost = 1) => {
      const config = configRef.current;
      const distance = Math.max(config.radius, 1);
      const curve = FALL_OFF[config.falloff];
      const now = performance.now();
      const minColumn = Math.max(0, Math.floor((x - distance - offsetX) / config.cellSize));
      const maxColumn = Math.min(columns - 1, Math.floor((x + distance - offsetX) / config.cellSize));
      const minRow = Math.max(0, Math.floor((y - distance - offsetY) / config.cellSize));
      const maxRow = Math.min(rows - 1, Math.floor((y + distance - offsetY) / config.cellSize));

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const index = row * columns + column;
          const [centerX, centerY] = cellCenter(index);
          const cellDistance = Math.hypot(centerX - x, centerY - y);
          if (cellDistance > distance) continue;
          const alpha = curve(1 - cellDistance / distance) * config.maxOpacity * boost;
          states[index].alpha = Math.max(states[index].alpha, alpha);
          states[index].touchedAt = now;
        }
      }
    };

    const draw = (now: number) => {
      const config = configRef.current;
      const delta = Math.min(now - previousFrame, 50);
      previousFrame = now;
      const [red, green, blue] = hexToRgb(config.color);
      context.clearRect(0, 0, width, height);

      if (config.gridOpacity > 0) {
        context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${config.gridOpacity})`;
        context.lineWidth = 1;
        context.beginPath();
        for (let column = 0; column <= columns; column += 1) {
          const x = Math.round(offsetX + column * config.cellSize) + 0.5;
          context.moveTo(x, 0);
          context.lineTo(x, height);
        }
        for (let row = 0; row <= rows; row += 1) {
          const y = Math.round(offsetY + row * config.cellSize) + 0.5;
          context.moveTo(0, y);
          context.lineTo(width, y);
        }
        context.stroke();
      }

      for (let pulseIndex = pulses.length - 1; pulseIndex >= 0; pulseIndex -= 1) {
        const pulse = pulses[pulseIndex];
        const ringRadius = ((now - pulse.t0) / 1_000) * config.pulseSpeed;
        if (ringRadius > Math.hypot(width, height)) {
          pulses.splice(pulseIndex, 1);
          continue;
        }
        const band = config.cellSize;
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const index = row * columns + column;
            const [centerX, centerY] = cellCenter(index);
            if (Math.abs(Math.hypot(centerX - pulse.x, centerY - pulse.y) - ringRadius) < band / 2) {
              states[index].alpha = config.maxOpacity;
              states[index].touchedAt = now;
            }
          }
        }
      }

      let visible = pulses.length > 0;
      const fadeStep = delta / Math.max(config.fadeDuration, 16);
      for (let index = 0; index < states.length; index += 1) {
        const state = states[index];
        if (state.alpha <= 0) continue;
        if (now - state.touchedAt > config.holdTime) state.alpha = Math.max(0, state.alpha - fadeStep);
        if (state.alpha <= 0) continue;
        visible = true;

        const [centerX, centerY] = cellCenter(index);
        const half = config.cellSize / 2;
        const glow = context.createRadialGradient(centerX, centerY, half * 0.1, centerX, centerY, config.cellSize);
        glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${state.alpha})`);
        glow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
        context.beginPath();
        const cellX = centerX - half + 0.5;
        const cellY = centerY - half + 0.5;
        const cellExtent = config.cellSize - 1;
        if (config.cellRadius > 0) context.roundRect(cellX, cellY, cellExtent, cellExtent, config.cellRadius);
        else context.rect(cellX, cellY, cellExtent, cellExtent);
        if (config.fillOpacity > 0) {
          context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${state.alpha * config.fillOpacity})`;
          context.fill();
        }
        context.strokeStyle = glow;
        context.lineWidth = config.lineWidth;
        context.stroke();
      }

      if (visible) {
        frameId = window.requestAnimationFrame(draw);
      } else {
        running = false;
      }
    };

    const wake = () => {
      if (running) return;
      running = true;
      previousFrame = performance.now();
      frameId = window.requestAnimationFrame(draw);
    };
    wakeRef.current = wake;

    const toLocal = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion) return;
      const [x, y] = toLocal(event);
      energize(x, y);
      wake();
    };

    const onPointerDown = (event: PointerEvent) => {
      const config = configRef.current;
      if (reducedMotion || !config.clickPulse) return;
      const [x, y] = toLocal(event);
      pulses = [...pulses, { x, y, t0: performance.now() }].slice(-3);
      wake();
    };

    const resizeObserver = new ResizeObserver(() => {
      rebuild();
      wake();
    });
    resizeObserver.observe(container);
    rebuild();
    wake();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      wakeRef.current = null;
    };
  }, [cellSize]);

  useEffect(() => {
    wakeRef.current?.();
  }, [color, fillOpacity, gridOpacity, lineWidth, maxOpacity, cellRadius]);

  return (
    <div ref={containerRef} className={`cursor-grid${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <canvas ref={canvasRef} className="cursor-grid__canvas" />
    </div>
  );
}
