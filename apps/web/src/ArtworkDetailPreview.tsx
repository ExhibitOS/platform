import {centerMetricModel,metricCameraFit} from './viewer/metric-model.js';
import { embeddedPNGManager } from './embedded-glb.js';
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import type { Artwork } from "@exhibitos/spec";
import type { PublicPublication } from "./publication-client";
import { DEVICE_BUDGETS, fetchVerifiedAsset, selectAssetVariant } from "./viewer/loading";
import type * as THREE from "three";

export interface DetailAnchor { id: string; position: [number, number, number]; text: string }
export function ArtworkDetailPreview({ publication, artwork, anchors }: {
  publication: PublicPublication; artwork: Artwork; anchors: DetailAnchor[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef({ yaw: 0, zoom: 1 });
  const [yaw, setYaw] = useState(0), [zoom, setZoom] = useState(1), [error, setError] = useState("");
  controls.current = { yaw, zoom };
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
        const inventory = selectAssetVariant(artwork, 0, DEVICE_BUDGETS.desktop);
        const asset = publication.assets.find(a => a.assetId === inventory.id);
        if (!asset) throw Error("DETAIL_UNAVAILABLE");
        const bytes = await fetchVerifiedAsset({ publicationId: publication.publication.id,
          revisionSha256: publication.publication.revisionSha256, asset, inventory, signal: abort.signal, ...publication.local });
        let object: THREE.Object3D;let modelExtent=Math.max(artwork.dimensions.width,artwork.dimensions.height),metric:ReturnType<typeof centerMetricModel>["measured"]|undefined;
        if (inventory.mime === "image/png") {
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          resources.add({ dispose: () => bitmap.close() });
          if (bitmap.width > 2048 || bitmap.height > 2048) throw Error("DETAIL_TEXTURE_BUDGET");
          const texture = new three.Texture(bitmap); texture.needsUpdate = true; texture.colorSpace = three.SRGBColorSpace;
          resources.add(texture);
          object = new three.Mesh(new three.PlaneGeometry(artwork.dimensions.width, artwork.dimensions.height),
            new three.MeshBasicMaterial({ map: texture, side: three.DoubleSide }));
          collect(object);
        } else {
          const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
          const manager = new three.LoadingManager();
          const protectedBytes = embeddedPNGManager(manager, bytes);
          resources.add(protectedBytes);
          object = (await new GLTFLoader(manager).parseAsync(protectedBytes.bytes, "")).scene;collect(object);protectedBytes.assertLoaded();
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
                if ((image?.width ?? 0) > 2048 || (image?.height ?? 0) > 2048) throw Error("DETAIL_TEXTURE_BUDGET");
              }
          });
          if (estimatedBytes > 96 * 1024 * 1024) throw Error("DETAIL_MEMORY_BUDGET");
          if (triangles > 100000) throw Error("DETAIL_GEOMETRY_BUDGET");
          const centered=centerMetricModel(three,object);object=centered.object;modelExtent=centered.extent;metric=centered.measured;
        }
        if (disposed || abort.signal.aborted) { release(); return; }
        const scene = new three.Scene(); scene.background = new three.Color("#181a20");
        const model = new three.Group(); model.add(object); scene.add(model);
        for (const anchor of anchors) {
          const marker = new three.Mesh(new three.SphereGeometry(modelExtent * .015, 12, 8),
            new three.MeshBasicMaterial({ color: "#ffd067", depthTest: false }));
          marker.position.fromArray(anchor.position); marker.renderOrder = 1; model.add(marker); collect(marker);
        }
        scene.add(new three.HemisphereLight(0xffffff, 0x333344, 3));
        const light = new three.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light);
        renderer = new three.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.domElement.setAttribute("aria-label", "작품 상세 3D 미리보기");
        target!.append(renderer.domElement);
        const camera = new three.PerspectiveCamera(45, 1, modelExtent/100, modelExtent*100);
        const extent = modelExtent;
        const resize = () => { const w = Math.max(1,target!.clientWidth), h = 360; renderer!.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(resize); observer.observe(target!); resize();
        const render = () => { if (disposed) return; model.rotation.y = controls.current.yaw * Math.PI / 180;
          const fit=metricCameraFit(extent,camera.aspect,controls.current.zoom);camera.near=fit.near;camera.far=fit.far;camera.updateProjectionMatrix();camera.position.set(0,0,fit.distance);camera.lookAt(0,0,0);
          renderer!.render(scene, camera);
          renderer!.domElement.dataset.detailState = JSON.stringify({ rotationY: model.rotation.y, cameraPosition: camera.position.toArray(), clipping:[camera.near,camera.far], zoom: controls.current.zoom, dimensions: artwork.dimensions, measuredGeometry:metric, anchors: anchors.map(a => a.position) });
          frame = requestAnimationFrame(render); };
        render();
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
  }, [publication, artwork, anchors]);
  return <section aria-label="작품 확대 및 회전">
    <div ref={host} className="detail-preview" data-testid="detail-preview" />
    {error && <p role="status">{error}</p>}
    <label>작품 회전 {yaw}° <input aria-label="작품 회전" type="range" min="-180" max="180" step="5" value={yaw} onChange={e => setYaw(Number(e.target.value))} /></label>
    <label>작품 확대 {zoom.toFixed(1)}× <input aria-label="작품 확대" type="range" min=".5" max="3" step=".1" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
    <button onClick={() => { setYaw(0); setZoom(1); }}>상세 시점 초기화</button>
    <p>작품의 미터 단위 좌표를 유지하는 디지털 미리보기입니다. 화면의 물리적 크기와는 다릅니다. 회전·확대 슬라이더는 방향키로도 조작할 수 있습니다.</p>
  </section>;
}
