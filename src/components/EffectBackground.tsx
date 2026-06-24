import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type { BgEffect } from "../state";
import { AURORA_FRAG, AURORA_VERT, GRAINIENT_FRAG, GRAINIENT_VERT, hexToRgb } from "../lib/effects/shaders";

type Uniforms = Record<string, { value: unknown }>;
type FrameCtx = { time: number; bufW: number; bufH: number };

const FILL = { position: "absolute", inset: 0 } as const;

/**
 * Mounts an ogl WebGL2 shader filling the 1280×720 stage. The drawing buffer is fixed at
 * canvas size (not the on-screen scaled size) and `preserveDrawingBuffer` is on, so
 * html-to-image captures a crisp, full-res frozen frame on export. `onFrame` runs every
 * rAF tick via a ref, so prop changes flow to uniforms without rebuilding the context.
 */
function useShader(vertex: string, fragment: string, initUniforms: () => Uniforms, onFrame: (u: Uniforms, c: FrameCtx) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true, // required so toPng() can read the canvas on export
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // aurora outputs premultiplied alpha
    const canvas = gl.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const program = new Program(gl, { vertex, fragment, uniforms: initUniforms() });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    // Size the drawing buffer from the container's LAYOUT size (offsetWidth, which ignores
    // the stage's `transform: scale()`), so it's constant whether zoomed or reset for export,
    // and tracks an effect-element box being resized. ResizeObserver avoids per-frame reflow.
    const setSize = () => renderer.setSize(Math.max(1, container.offsetWidth), Math.max(1, container.offsetHeight));
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      onFrameRef.current(program.uniforms, { time: (t - t0) * 0.001, bufW: gl.drawingBufferWidth, bufH: gl.drawingBufferHeight });
      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try {
        container.removeChild(canvas);
      } catch {
        /* already detached */
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [vertex, fragment]);

  return containerRef;
}

const f32 = (v: number[]) => new Float32Array(v);
const setRgb = (target: unknown, hex: string) => {
  const a = target as Float32Array;
  const [r, g, b] = hexToRgb(hex);
  a[0] = r;
  a[1] = g;
  a[2] = b;
};

function GrainientCanvas({ e }: { e: Extract<BgEffect, { preset: "grainient" }> }) {
  const ref = useShader(
    GRAINIENT_VERT,
    GRAINIENT_FRAG,
    () => ({
      iTime: { value: 0 },
      iResolution: { value: f32([1, 1]) },
      uTimeSpeed: { value: 0 },
      uColorBalance: { value: 0 },
      uWarpStrength: { value: 1 },
      uWarpFrequency: { value: 5 },
      uWarpSpeed: { value: 2 },
      uWarpAmplitude: { value: 50 },
      uBlendAngle: { value: 0 },
      uBlendSoftness: { value: 0.05 },
      uRotationAmount: { value: 500 },
      uNoiseScale: { value: 2 },
      uGrainAmount: { value: 0.1 },
      uGrainScale: { value: 2 },
      uGrainAnimated: { value: 0 },
      uContrast: { value: 1.5 },
      uGamma: { value: 1 },
      uSaturation: { value: 1 },
      uCenterOffset: { value: f32([0, 0]) },
      uZoom: { value: 0.9 },
      uColor1: { value: f32([1, 1, 1]) },
      uColor2: { value: f32([1, 1, 1]) },
      uColor3: { value: f32([1, 1, 1]) },
    }),
    (u, c) => {
      u.iTime.value = c.time;
      (u.iResolution.value as Float32Array)[0] = c.bufW;
      (u.iResolution.value as Float32Array)[1] = c.bufH;
      u.uTimeSpeed.value = e.timeSpeed;
      u.uColorBalance.value = e.colorBalance;
      u.uWarpStrength.value = e.warpStrength;
      u.uWarpFrequency.value = e.warpFrequency;
      u.uWarpSpeed.value = e.warpSpeed;
      u.uWarpAmplitude.value = e.warpAmplitude;
      u.uBlendAngle.value = e.blendAngle;
      u.uBlendSoftness.value = e.blendSoftness;
      u.uRotationAmount.value = e.rotationAmount;
      u.uNoiseScale.value = e.noiseScale;
      u.uGrainAmount.value = e.grainAmount;
      u.uGrainScale.value = e.grainScale;
      u.uGrainAnimated.value = e.grainAnimated ? 1 : 0;
      u.uContrast.value = e.contrast;
      u.uGamma.value = e.gamma;
      u.uSaturation.value = e.saturation;
      (u.uCenterOffset.value as Float32Array)[0] = e.centerX;
      (u.uCenterOffset.value as Float32Array)[1] = e.centerY;
      u.uZoom.value = e.zoom;
      setRgb(u.uColor1.value, e.color1);
      setRgb(u.uColor2.value, e.color2);
      setRgb(u.uColor3.value, e.color3);
    },
  );
  return <div ref={ref} style={FILL} />;
}

function AuroraCanvas({ e }: { e: Extract<BgEffect, { preset: "aurora" }> }) {
  const ref = useShader(
    AURORA_VERT,
    AURORA_FRAG,
    () => ({
      uTime: { value: 0 },
      uAmplitude: { value: 1 },
      uColorStops: { value: [f32([1, 1, 1]), f32([1, 1, 1]), f32([1, 1, 1])] },
      uResolution: { value: f32([1, 1]) },
      uBlend: { value: 0.5 },
    }),
    (u, c) => {
      u.uTime.value = c.time * e.speed;
      u.uAmplitude.value = e.amplitude;
      u.uBlend.value = e.blend;
      const stops = u.uColorStops.value as Float32Array[];
      setRgb(stops[0], e.color1);
      setRgb(stops[1], e.color2);
      setRgb(stops[2], e.color3);
      (u.uResolution.value as Float32Array)[0] = c.bufW;
      (u.uResolution.value as Float32Array)[1] = c.bufH;
    },
  );
  return <div ref={ref} style={FILL} />;
}

function MeshBg({ e }: { e: Extract<BgEffect, { preset: "mesh" }> }) {
  const spread = 35 + e.softness * 45; // % radius where the blob fades to transparent
  return (
    <div
      style={{
        ...FILL,
        backgroundColor: e.bgColor,
        backgroundImage: [
          `radial-gradient(circle at 18% 22%, ${e.color1}, transparent ${spread}%)`,
          `radial-gradient(circle at 82% 18%, ${e.color2}, transparent ${spread}%)`,
          `radial-gradient(circle at 50% 88%, ${e.color3}, transparent ${spread}%)`,
        ].join(","),
      }}
    />
  );
}

function DotsBg({ e }: { e: Extract<BgEffect, { preset: "dots" }> }) {
  return (
    <div
      style={{
        ...FILL,
        backgroundColor: e.bgColor,
        backgroundImage: `radial-gradient(${e.dotColor} ${e.size}px, transparent ${e.size + 0.5}px)`,
        backgroundSize: `${e.gap}px ${e.gap}px`,
      }}
    />
  );
}

export function EffectBackground({ effect }: { effect: BgEffect }) {
  switch (effect.preset) {
    case "grainient":
      return <GrainientCanvas e={effect} />;
    case "aurora":
      return <AuroraCanvas e={effect} />;
    case "mesh":
      return <MeshBg e={effect} />;
    case "dots":
      return <DotsBg e={effect} />;
  }
}
