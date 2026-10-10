'use client';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, QuadraticBezierLine, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { GEdge, GNode } from '@/lib/graph/build';
import { GLOBE_R, type V3 } from '@/lib/graph/globe';
import { money } from '@/lib/analytics/format';

export interface GlobeNode { node: GNode; pos: V3; color: string; radius: number }
export interface GlobeEdge { edge: GEdge; a: V3; b: V3; mid: V3; color: string }

interface SceneProps {
  nodes: GlobeNode[];
  edges: GlobeEdge[];
  selectedId: string | null;
  hoverId: string | null;
  autoRotate: boolean;
  labels: 'all' | 'major';
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

// Colours are pushed above 1.0 so the bloom pass picks them up as light sources.
const glow = (hex: string, k = 1.6) => new THREE.Color(hex).multiplyScalar(k);

/** Translucent globe: lat/long grid plus a fresnel atmosphere rim. */
function Shell() {
  const grid = useMemo(() => {
    const pts: number[] = [];
    const R = GLOBE_R;
    for (let lat = -60; lat <= 60; lat += 30) {
      const r = R * Math.cos((lat * Math.PI) / 180), y = R * Math.sin((lat * Math.PI) / 180);
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2, b = ((i + 1) / 96) * Math.PI * 2;
        pts.push(r * Math.cos(a), y, r * Math.sin(a), r * Math.cos(b), y, r * Math.sin(b));
      }
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const t = (lon * Math.PI) / 180;
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2, b = ((i + 1) / 96) * Math.PI * 2;
        pts.push(R * Math.cos(a) * Math.cos(t), R * Math.sin(a), R * Math.cos(a) * Math.sin(t), R * Math.cos(b) * Math.cos(t), R * Math.sin(b), R * Math.cos(b) * Math.sin(t));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const atmosphere = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: new THREE.Color('#3d7bff') } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(c * 1.4, f * 0.55); }',
  }), []);
  return (
    <group>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color="#2b5a8c" transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
      <mesh>
        <sphereGeometry args={[GLOBE_R * 0.995, 64, 64]} />
        <meshBasicMaterial color="#0a1830" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <mesh material={atmosphere} scale={1.12}>
        <sphereGeometry args={[GLOBE_R, 64, 64]} />
      </mesh>
    </group>
  );
}

/** The parent company: a bright core with a slowly turning ring. */
function Core({ onSelect }: { onSelect: () => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.25;
    if (ring2.current) ring2.current.rotation.x += dt * 0.18;
  });
  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <mesh>
        <sphereGeometry args={[1.3, 48, 48]} />
        <meshBasicMaterial color={glow('#ffe7b0', 2.2)} toneMapped={false} />
      </mesh>
      <mesh scale={1.9}>
        <sphereGeometry args={[1.3, 32, 32]} />
        <meshBasicMaterial color="#ffb347" transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[2.4, 0.03, 8, 128]} />
        <meshBasicMaterial color={glow('#e5c26b', 2)} toneMapped={false} />
      </mesh>
      <mesh ref={ring2} rotation={[0, Math.PI / 3, 0]}>
        <torusGeometry args={[2.9, 0.015, 8, 128]} />
        <meshBasicMaterial color={glow('#e5c26b', 1.4)} toneMapped={false} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function Orb({ g, selected, hovered, onSelect, onHover }: { g: GlobeNode; selected: boolean; hovered: boolean; onSelect: (id: string) => void; onHover: (id: string | null) => void }) {
  const { node, pos, color, radius } = g;
  const d = node.data;
  const body = useRef<THREE.Mesh>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const sat = useRef<THREE.Group>(null);
  const dim = d.dim && !selected && !hovered;
  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    if (body.current) {
      const target = hovered || selected ? 1.3 : 1;
      body.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 8));
      if (d.kind !== 'vertical' && d.kind !== 'product') body.current.rotation.y += dt * 0.6;
    }
    if (pulse.current) {
      const p = (t * 0.7) % 1;
      pulse.current.scale.setScalar(1.2 + p * 1.4);
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.6 * d.risk;
    }
    if (sat.current) sat.current.rotation.y += dt * 0.9;
  });
  const geo =
    d.kind === 'segment' ? <octahedronGeometry args={[radius, 0]} />
      : d.kind === 'infra' ? <boxGeometry args={[radius * 1.3, radius * 1.3, radius * 1.3]} />
        : d.kind === 'function' ? <dodecahedronGeometry args={[radius, 0]} />
          : d.kind === 'acquisition' || d.kind === 'cluster' ? <icosahedronGeometry args={[radius, 1]} />
            : <sphereGeometry args={[radius, 32, 32]} />;
  const wire = d.kind === 'acquisition' || d.kind === 'cluster' || d.ghost;
  const handle = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(node.id); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(node.id); document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { onHover(null); document.body.style.cursor = ''; },
  };
  const riskColor = d.risk >= 0.75 ? '#ff3b4e' : '#ff8a3d';
  return (
    <group position={pos}>
      <mesh ref={body} {...handle}>
        {geo}
        <meshBasicMaterial color={glow(color, dim ? 0.35 : d.kind === 'vertical' ? 1.9 : 1.4)} toneMapped={false} wireframe={wire} transparent opacity={dim ? 0.25 : 1} />
      </mesh>
      {!dim && (
        <mesh scale={d.kind === 'vertical' ? 2.1 : 1.8}>
          <sphereGeometry args={[radius, 24, 24]} />
          <meshBasicMaterial color={color} transparent opacity={d.kind === 'vertical' ? 0.16 : 0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
      {d.risk >= 0.5 && !dim && (
        <mesh ref={pulse}>
          <sphereGeometry args={[radius, 24, 24]} />
          <meshBasicMaterial color={riskColor} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} wireframe />
        </mesh>
      )}
      {d.opportunity > 0 && !dim && (
        <group ref={sat}>
          <mesh position={[radius * 2.2, radius * 0.6, 0]}>
            <sphereGeometry args={[Math.max(0.09, radius * 0.22), 16, 16]} />
            <meshBasicMaterial color={glow('#3dffa0', 2.2)} toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Arc({ e, highlight, dim }: { e: GlobeEdge; highlight: boolean; dim: boolean }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  const d = e.edge.data;
  const march = d.march || d.dash;
  useFrame((_, dt) => {
    if (ref.current && march) ref.current.material.dashOffset -= dt * 1.2;
  });
  return (
    <QuadraticBezierLine
      ref={ref as never}
      start={e.a}
      end={e.b}
      mid={e.mid}
      color={glow(e.color, highlight ? 2 : 1.25)}
      lineWidth={Math.max(0.6, d.width * (highlight ? 1.2 : 0.75))}
      dashed={!!march}
      dashSize={0.5}
      gapSize={0.35}
      transparent
      opacity={dim ? 0.05 : d.kind === 'ownership' ? 0.35 : highlight ? 1 : 0.6}
      toneMapped={false}
    />
  );
}

/** All flow particles in one instanced mesh: money (and other flows) travelling along their arcs. */
function Particles({ edges }: { edges: GlobeEdge[] }) {
  const items = useMemo(() => {
    const list: { curve: THREE.QuadraticBezierCurve3; speed: number; offset: number; color: THREE.Color; size: number }[] = [];
    for (const e of edges) {
      const d = e.edge.data;
      if (!d.flow || d.dim) continue;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...e.a), new THREE.Vector3(...e.mid), new THREE.Vector3(...e.b));
      const n = Math.min(5, d.particles + 1);
      for (let i = 0; i < n; i++) list.push({ curve, speed: 1 / Math.max(1.2, d.duration * 1.4), offset: i / n, color: glow(d.kind === 'ownership' ? '#ffd27a' : e.color, 2.4), size: d.kind === 'journey' ? 0.16 : 0.09 + d.strength * 0.05 });
    }
    return list.slice(0, 1500);
  }, [edges]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.getElapsedTime();
    items.forEach((it, i) => {
      tmp.position.copy(it.curve.getPoint((t * it.speed + it.offset) % 1));
      tmp.scale.setScalar(it.size);
      tmp.updateMatrix();
      mesh.current!.setMatrixAt(i, tmp.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  if (!items.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, items.length]} key={items.length} onUpdate={(m) => { items.forEach((it, i) => m.setColorAt(i, it.color)); if (m.instanceColor) m.instanceColor.needsUpdate = true; }}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * Projects node positions to screen space every frame and moves the label DOM nodes directly —
 * one React tree for all labels, labels on the far side of the globe fade for depth.
 */
function LabelProjector({ nodes, els }: { nodes: GlobeNode[]; els: React.RefObject<Map<string, HTMLDivElement>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const camDir = camera.position.clone().normalize();
    for (const g of nodes) {
      const el = els.current?.get(g.node.id);
      if (!el) continue;
      v.set(g.pos[0], g.pos[1] - (g.node.id === 'parent' ? 2.1 : g.radius * 1.9 + 0.3), g.pos[2]);
      const dist = camera.position.distanceTo(v);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
      const len = Math.hypot(...g.pos);
      const behind = len > 0.5 && len <= GLOBE_R * 1.1 && new THREE.Vector3(...g.pos).normalize().dot(camDir) < -0.1;
      const k = Math.max(0.6, Math.min(1.25, 32 / dist));
      el.style.transform = `translate(-50%, 0) translate(${x}px, ${y}px) scale(${k})`;
      el.style.setProperty('--depth', behind ? '0.25' : '1');
    }
  });
  return null;
}

function SceneImpl({ nodes, edges, selectedId, hoverId, autoRotate, labels, onSelect, onHover }: SceneProps) {
  const focus = hoverId ?? selectedId;
  const many = nodes.length > 80;
  const els = useRef(new Map<string, HTMLDivElement>());
  const showLabel = (g: GlobeNode) => {
    const k = g.node.data.kind;
    if (g.node.id === 'parent' || k === 'vertical' || g.node.id === hoverId || g.node.id === selectedId) return true;
    return labels === 'all' && (!many || k === 'segment');
  };
  return (
    <div className="relative size-full">
    <Canvas camera={{ position: [0, 9, 30], fov: 45, near: 0.1, far: 500 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} onPointerMissed={() => onSelect(null)}>
      <Stars radius={140} depth={60} count={4000} factor={3.2} saturation={0.6} fade speed={0.6} />
      <Shell />
      {edges.map((e) => (
        <Arc key={e.edge.id} e={e} highlight={!!focus && (e.edge.source === focus || e.edge.target === focus) || e.edge.data.highlight} dim={e.edge.data.dim} />
      ))}
      <Particles edges={edges} />
      {nodes.map((g) =>
        g.node.id === 'parent' ? (
          <Core key="parent" onSelect={() => onSelect('parent')} />
        ) : (
          <Orb key={g.node.id} g={g} selected={selectedId === g.node.id} hovered={hoverId === g.node.id} onSelect={onSelect} onHover={onHover} />
        ),
      )}
      <LabelProjector nodes={nodes} els={els} />
      <OrbitControls enablePan={false} enableDamping dampingFactor={0.08} autoRotate={autoRotate && !hoverId} autoRotateSpeed={0.45} minDistance={9} maxDistance={80} />
      <EffectComposer>
        <Bloom intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.25} mipmapBlur radius={0.75} />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
    </Canvas>
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {nodes.map((g) => {
        const d = g.node.data;
        const isParent = g.node.id === 'parent';
        const visible = showLabel(g);
        const riskColor = d.risk >= 0.75 ? '#ff3b4e' : '#ff8a3d';
        return (
          <div
            key={g.node.id}
            ref={(el) => { if (el) els.current.set(g.node.id, el); else els.current.delete(g.node.id); }}
            className="absolute left-0 top-0 origin-top whitespace-nowrap text-center transition-opacity duration-300"
            style={{ opacity: visible ? `calc(var(--depth, 1) * ${d.dim && !isParent ? 0.3 : 1})` : 0, willChange: 'transform' }}
          >
            <div className={isParent ? 'text-[15px] font-semibold tracking-wide text-white' : d.kind === 'vertical' ? 'text-[13px] font-semibold text-white' : 'text-[11px] text-white'} style={{ textShadow: `0 0 10px ${isParent ? 'rgba(255,200,120,0.9)' : g.color}, 0 0 2px #000` }}>{d.label}</div>
            <div className="num text-[11px]" style={{ color: isParent ? '#ffe7b0' : g.color, textShadow: '0 0 2px #000' }}>
              {d.valueLabel}
              {d.kind === 'vertical' && d.growth !== null && <span className="ml-1.5" style={{ color: d.growth >= 0 ? '#5dffa8' : '#ff6b7a' }}>{d.growth >= 0 ? '▲' : '▼'}{Math.abs(Math.round(d.growth * 100))}%</span>}
            </div>
            {d.opportunity > 0 && !isParent && <div className="num text-[10px] text-[#3dffa0]">+{money(d.opportunity)} opportunity</div>}
            {d.riskCount > 0 && d.risk >= 0.5 && <div className="text-[10px]" style={{ color: riskColor }}>⚠ {d.riskCount} risk{d.riskCount > 1 ? 's' : ''}</div>}
          </div>
        );
      })}
    </div>
    </div>
  );
}

export const GlobeScene = memo(SceneImpl);
