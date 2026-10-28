import {DEFAULT_REFERENCE_TONE,applyReferenceOutput,installReferenceEnvironment,environmentEstimate,type ReferenceTone} from './viewer/render-quality';
import {basisLoader} from './basis-loader.js';
import {centerMetricModel,metricCameraFit,artifactMetricModel} from './viewer/metric-model.js';
import { embeddedPNGManager } from './embedded-glb.js';
import {WatermarkOverlay} from './WatermarkOverlay';
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useId, useRef, useState } from "react";
import type { Artwork } from "@exhibitos/spec";
import type { PublicPublication } from "./publication-client";
import { checkImageDecode, deviceBudget, fetchVerifiedAsset, selectAssetVariant } from "./viewer/loading";
import type * as THREE from "three";

import { DetailGesture, detailView, INITIAL_DETAIL_VIEW } from "./viewer/detail-gesture";

export interface DetailAnchor { id: string; position: [number, number, number]; text: string }
export function ArtworkDetailPreview({ publication, artwork, anchors, referenceTone = DEFAULT_REFERENCE_TONE }: {
  referenceTone?: ReferenceTone;
  publication: PublicPublication; artwork: Artwork; anchors: DetailAnchor[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(INITIAL_DETAIL_VIEW), [error, setError] = useState("");
  const { yaw, pitch, zoom } = view;
  const controls = useRef(view);
  const hint = useId();
  const changeView = (next: typeof view) => { controls.current = next; setView(next); };
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const gesture = new DetailGesture();
    const captured = new Set<number>();
    const clear = () => {
      gesture.clear(); delete target.dataset.dragging;
      for (const id of captured) if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
      captured.clear();
    };
    const visibility = () => { if (document.visibilityState === "hidden") clear(); };
    const down = (event: PointerEvent) => {
      if (captured.size >= 2 || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
      target.focus({ preventScroll: true });
      try { target.setPointerCapture(event.pointerId); } catch { return; }
      captured.add(event.pointerId); gesture.begin(event.pointerId, { x: event.clientX, y: event.clientY });
      target.dataset.dragging = "true"; event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!captured.has(event.pointerId)) return;
      changeView(gesture.move(event.pointerId, { x: event.clientX, y: event.clientY }, controls.current));
      event.preventDefault();
    };
    const end = (event: PointerEvent) => {
      gesture.end(event.pointerId); captured.delete(event.pointerId);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      if (!captured.size) delete target.dataset.dragging;
    };
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== target || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1);
      changeView(detailView({ ...controls.current, zoom: controls.current.zoom * Math.exp(-Math.max(-300, Math.min(300, pixels)) * .002) }));
    };
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const next = { ...controls.current };
      switch (event.key) {
        case "ArrowLeft": next.yaw -= 5; break;
        case "ArrowRight": next.yaw += 5; break;
        case "ArrowUp": next.pitch -= 5; break;
        case "ArrowDown": next.pitch += 5; break;
        case "+": case "=": next.zoom += .1; break;
        case "-": next.zoom -= .1; break;
        case "Home": Object.assign(next, INITIAL_DETAIL_VIEW); break;
        default: return;
      }
      event.preventDefault(); event.stopPropagation(); changeView(detailView(next));
    };
    target.addEventListener("pointerdown", down); target.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) target.addEventListener(type, end);
    target.addEventListener("wheel", wheel, { passive: false }); target.addEventListener("keydown", key);
    target.addEventListener("blur", clear); window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clear(); target.removeEventListener("pointerdown", down); target.removeEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) target.removeEventListener(type, end);
      target.removeEventListener("wheel", wheel); target.removeEventListener("keydown", key);
      target.removeEventListener("blur", clear); window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const abort = new AbortController();
    let disposed = false, frame = 0;
    const resources = new Set<{ dispose(): void }>();
    let three: typeof import("three");
    let renderer: THREE.WebGLRenderer | undefined;
    let observer: ResizeObserver | undefined;
    const release = () => { for (const resource of resources) resource.dispose(); resources.clear(); };
    const collect = (object: THREE.Object3D) => object.traverse(node => {
      if (!(node instanceof three.Mesh)) return;
      resources.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof three.Texture) resources.add(value);
      }
    });
    async function start() {
      try {
        three = await import("three");
        if (disposed) return;
        const budget=deviceBudget({viewportWidth:window.innerWidth,deviceMemory:(navigator as Navigator & {deviceMemory?:number}).deviceMemory});
        const environmentReserve=environmentEstimate(budget.maxTextureSize<=512?64:128).generationPeakBytes;
        renderer = new three.WebGLRenderer({ antialias: true });resources.add(renderer);
        applyReferenceOutput(three,renderer,referenceTone);
        const inventory = selectAssetVariant(artwork, 0, budget);
        const asset = publication.assets.find(a => a.assetId === inventory.id);
        if (!asset) throw Error("DETAIL_UNAVAILABLE");
        const bytes = await fetchVerifiedAsset({ publicationId: publication.publication.id,
          revisionSha256: publication.publication.revisionSha256, asset, inventory, signal: abort.signal, ...publication.local });
        let object: THREE.Object3D;let modelExtent=Math.max(artwork.dimensions.width,artwork.dimensions.height),metric:ReturnType<typeof centerMetricModel>["measured"]|undefined;
        if (inventory.mime === "image/png") {
          const sourceSize=checkImageDecode(bytes,artwork,inventory,budget);
          let bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), { imageOrientation: "flipY" });
          resources.add({ dispose: () => bitmap.close() });
          if(disposed||abort.signal.aborted){release();return;}
          if(sourceSize&&(bitmap.width!==sourceSize.width||bitmap.height!==sourceSize.height))throw Error('IMAGE_DECODE_BUDGET');
          if (bitmap.width > budget.maxTextureSize || bitmap.height > budget.maxTextureSize) {
            const scale=budget.maxTextureSize/Math.max(bitmap.width,bitmap.height),resized=await createImageBitmap(bitmap,{imageOrientation:'none',resizeWidth:Math.max(1,Math.round(bitmap.width*scale)),resizeHeight:Math.max(1,Math.round(bitmap.height*scale))});
            if(disposed||abort.signal.aborted){resized.close();release();return;}
            bitmap.close();bitmap=resized;
          }
          if(bitmap.width*bitmap.height*4*4/3>budget.maxCacheBytes-environmentReserve)throw Error('DETAIL_MEMORY_BUDGET');
          const texture = new three.Texture(bitmap); texture.needsUpdate = true; texture.colorSpace = three.SRGBColorSpace;
          resources.add(texture);
          object = new three.Mesh(new three.PlaneGeometry(artwork.dimensions.width, artwork.dimensions.height),
            new three.MeshBasicMaterial({ map: texture, side: three.DoubleSide, toneMapped: false }));
          collect(object);
        } else {
          const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
          const manager = new three.LoadingManager();
          const basis=await basisLoader(renderer!,bytes);if(basis)resources.add(basis);
          if(disposed||abort.signal.aborted){release();return;}
          const protectedBytes = embeddedPNGManager(manager, bytes,basis);
          resources.add(protectedBytes);
          const loader=new GLTFLoader(manager);if(protectedBytes.ktx2Loader)loader.setKTX2Loader(protectedBytes.ktx2Loader as never);
          object = (await loader.parseAsync(protectedBytes.bytes, "")).scene;collect(object);protectedBytes.assertLoaded();
          let triangles = 0, estimatedBytes = 0;
          const measured = new Set<unknown>();
          object.traverse(node => {
            if (!(node instanceof three.Mesh)) return;
            for (const attribute of Object.values(node.geometry.attributes) as Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>) {
              if (!measured.has(attribute)) { measured.add(attribute); estimatedBytes += attribute.array.byteLength; }
            }
            if (node.geometry.index && !measured.has(node.geometry.index)) { measured.add(node.geometry.index); estimatedBytes += node.geometry.index.array.byteLength; }
            triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3;
            for (const material of Array.isArray(node.material) ? node.material : [node.material])
              for (const value of Object.values(material)) if (value instanceof three.Texture) {
                const image = value.image as { width?: number; height?: number } | undefined;
                if (!measured.has(value)) { measured.add(value); estimatedBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 4 / 3; }
                if ((image?.width ?? 0) > budget.maxTextureSize || (image?.height ?? 0) > budget.maxTextureSize) throw Error("DETAIL_TEXTURE_BUDGET");
              }
          });
          if (estimatedBytes > budget.maxCacheBytes-environmentReserve) throw Error("DETAIL_MEMORY_BUDGET");
          if (triangles > budget.maxTriangles) throw Error("DETAIL_GEOMETRY_BUDGET");
          const centered=centerMetricModel(three,object);object=centered.object;modelExtent=centered.extent;metric=centered.measured;
        }
        if (disposed || abort.signal.aborted) { release(); return; }
        const scene = new three.Scene(); scene.background = new three.Color("#181a20");
        const artifact=artifactMetricModel(three,object,artwork.transform);object=artifact.object;modelExtent=artifact.extent;const centre=artifact.center;
        const model = new three.Group();model.position.copy(centre);const contents=new three.Group();contents.position.copy(centre).negate();contents.add(object);model.add(contents);scene.add(model);
        for (const anchor of anchors) {
          const marker = new three.Mesh(new three.SphereGeometry(modelExtent * .015, 12, 8),
            new three.MeshBasicMaterial({ color: "#ffd067", depthTest: false }));
          marker.position.fromArray(anchor.position); marker.renderOrder = 1; object.add(marker); collect(marker);
        }
        const hemisphere=new three.HemisphereLight(0xffffff, 0x333344, 3);scene.add(hemisphere);
        const light = new three.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
        renderer!.setPixelRatio(Math.min(devicePixelRatio, budget.maxPixelRatio));
        renderer.domElement.setAttribute("aria-label", "작품 상세 3D 미리보기");
        target!.append(renderer.domElement);
        const camera = new three.PerspectiveCamera(45, 1, modelExtent/100, modelExtent*100);
        const extent = modelExtent;
        const resize = () => { const w = Math.max(1,target!.clientWidth), h = Math.max(1,target!.clientHeight); renderer!.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(resize); observer.observe(target!); resize();
        const render = () => { if (disposed) return; model.rotation.set(controls.current.pitch * Math.PI / 180, controls.current.yaw * Math.PI / 180, 0, "YXZ");
          const fit=metricCameraFit(extent,camera.aspect,controls.current.zoom);camera.near=fit.near;camera.far=fit.far;camera.updateProjectionMatrix();camera.position.copy(centre).add(new three.Vector3(0,0,fit.distance));camera.lookAt(centre);
          renderer!.render(scene, camera);
          renderer!.domElement.dataset.detailState = JSON.stringify({ rotationX: model.rotation.x, rotationY: model.rotation.y, cameraPosition: camera.position.toArray(), clipping:[camera.near,camera.far], zoom: controls.current.zoom, dimensions: artwork.dimensions, measuredGeometry:metric,artifactGeometry:artifact.measured, anchors: anchors.map(a => a.position),anchorWorld:object.children.filter(n=>n.renderOrder===1).map(n=>n.getWorldPosition(new three.Vector3()).toArray()) });
          frame = requestAnimationFrame(render); };
        render();
        void installReferenceEnvironment(three,renderer,scene,environmentReserve,budget.maxTextureSize<=512,()=>disposed||abort.signal.aborted).then(environment=>{
          if(!environment)return;if(disposed||abort.signal.aborted){environment.dispose();return;}
          resources.add(environment);scene.environmentIntensity=.45;hemisphere.intensity=.6;light.intensity=2;
          renderer!.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environmentSize:environment.size,environmentReserveBytes:environmentReserve,assetBudgetBytes:budget.maxCacheBytes-environmentReserve});
        }).catch(()=>{});
      } catch { if (!disposed) { setError("현재 권리 또는 그래픽·기기 예산 때문에 상세 이미지를 표시할 수 없습니다. 설명은 아래에서 읽을 수 있습니다."); release(); } }
    }
    // No persistent cache. Revoke the visible detail if authoritative publication availability changes.
    const check = async () => { try {
      if (publication.local) { await publication.local.check(); return; }
      const response = await fetch(`/api/v1/publications/${publication.publication.id}`, { cache: "no-store", credentials: "omit", signal: abort.signal });
      if (!response.ok || (await response.json()).publication.revisionSha256 !== publication.publication.revisionSha256) throw Error("REVOKED");
    } catch { if (!disposed) { abort.abort(); cancelAnimationFrame(frame); observer?.disconnect(); renderer?.domElement.remove(); renderer?.dispose(); release(); setError("공개 상태를 확인할 수 없어 상세 표시를 중단했습니다."); } } };
    const timer = setInterval(() => void check(), 10000);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    void start();
    return () => { disposed = true; abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible);
      cancelAnimationFrame(frame); observer?.disconnect(); renderer?.domElement.remove(); renderer?.dispose(); release(); };
  }, [publication, artwork, anchors, referenceTone]);
  return <section aria-label="작품 확대 및 회전">
    <div className="watermark-display-stage"><div ref={host} className="detail-preview" data-testid="detail-preview" tabIndex={0} role="group" aria-label="작품 회전 및 확대 조작" aria-describedby={hint} /><WatermarkOverlay candidate={publication.exhibition}/></div>
    <p id={hint} className="detail-gesture-hint">드래그하여 상하·좌우 회전 · 두 손가락으로 확대. 키보드는 방향키·+/−, Home으로 초기화합니다.</p>
    {error && <p role="status">{error}</p>}
    <label>작품 회전 {Math.round(yaw)}° <input aria-label="작품 회전" type="range" min="-180" max="180" step="5" value={yaw} onChange={e => changeView(detailView({ ...controls.current, yaw: Number(e.target.value) }))} /></label>
    <label>작품 상하 회전 {Math.round(pitch)}° <input aria-label="작품 상하 회전" type="range" min="-90" max="90" step="5" value={pitch} onChange={e => changeView(detailView({ ...controls.current, pitch: Number(e.target.value) }))} /></label>
    <label>작품 확대 {zoom.toFixed(1)}× <input aria-label="작품 확대" type="range" min=".5" max="3" step=".1" value={zoom} onChange={e => changeView(detailView({ ...controls.current, zoom: Number(e.target.value) }))} /></label>
    <button onClick={() => changeView({ ...INITIAL_DETAIL_VIEW })}>상세 시점 초기화</button>
    <p>작품의 미터 단위 좌표를 유지하는 디지털 미리보기입니다. 화면의 물리적 크기와는 다릅니다. 회전·확대 슬라이더는 방향키로도 조작할 수 있습니다.</p>
  </section>;
}
