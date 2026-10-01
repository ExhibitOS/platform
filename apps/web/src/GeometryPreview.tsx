import { useEffect, useRef, useState } from "react";
import { presentationFor } from "@exhibitos/studio-contract";
import type { Session } from "./cms-client";
import type { Draft } from "./drafts/store";

type Document = Draft["candidate"];
export interface SurfaceAppearance {
  baseColor: [number, number, number];
  roughness: number;
  metalness: number;
}
export interface GeometrySelection {
  kind: "room" | "surface" | "opening";
  id: string;
}

// Partition centered XY rectangles instead of triangulating holes that touch a
// wall edge. A floor-level door is an actual empty region in the rendered wall.
function panels(
  surface: Document["surfaces"][number],
  openings: Document["openings"],
) {
  const width = surface.dimensions.width,
    height = surface.dimensions.height;
  const rectangles = openings
    .filter((item) => item.surfaceId.toLowerCase() === surface.id.toLowerCase())
    .map((item) => ({
      left: item.offset[0] - item.dimensions.width / 2,
      right: item.offset[0] + item.dimensions.width / 2,
      bottom: item.offset[1] - item.dimensions.height / 2,
      top: item.offset[1] + item.dimensions.height / 2,
    }));
  const xs = [
    ...new Set([
      -width / 2,
      width / 2,
      ...rectangles.flatMap((item) => [item.left, item.right]),
    ]),
  ].sort((a, b) => a - b);
  const result: Array<{ x: number; y: number; width: number; height: number }> =
    [];
  for (let i = 0; i < xs.length - 1; i++) {
    const left = xs[i]!,
      right = xs[i + 1]!,
      mid = (left + right) / 2;
    if (right <= left) continue;
    const blocked = rectangles
      .filter((item) => mid > item.left && mid < item.right)
      .sort((a, b) => a.bottom - b.bottom);
    let bottom = -height / 2;
    for (const item of blocked) {
      if (item.bottom > bottom)
        result.push({
          x: mid,
          y: (bottom + item.bottom) / 2,
          width: right - left,
          height: item.bottom - bottom,
        });
      bottom = Math.max(bottom, item.top);
    }
    if (bottom < height / 2)
      result.push({
        x: mid,
        y: (bottom + height / 2) / 2,
        width: right - left,
        height: height / 2 - bottom,
      });
  }
  return result;
}

export function GeometryPreview({
  document,
  selection,
  appearance,
  session,
}: {
  document: Document;
  session: Session | null;
  selection: GeometrySelection | null;
  appearance: (surfaceId: string) => SurfaceAppearance;
}) {
  const host = useRef<HTMLDivElement>(null),
    action = useRef<
      | ((
          view:
            "isometric" | "top" | "front" | "left" | "right" | "start" | string,
        ) => void)
      | null
    >(null);
  const [message, setMessage] = useState("공간 미리보기를 준비합니다."),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let disposed = false,
      release = () => {};
    setReady(false);
    setMessage("공간 미리보기를 준비합니다.");
    const build = async () => {
      if (
        document.rooms.length > 32 ||
        document.surfaces.length > 256 ||
        document.openings.length > 128 ||
        document.placements.length > 128 ||
        document.lights.length > 128
      )
        throw Error("PREVIEW_COMPLEXITY");
      const values = [
        ...document.rooms.flatMap((room) => [
          ...Object.values(room.dimensions),
          ...room.transform.position,
        ]),
        ...document.surfaces.flatMap((surface) => [
          ...Object.values(surface.dimensions),
          ...surface.transform.position,
        ]),
      ];
      if (
        values.some(
          (value) => !Number.isFinite(value) || Math.abs(value) > 10000,
        )
      )
        throw Error("PREVIEW_COMPLEXITY");
      const rectangles = document.surfaces.map((surface) =>
        panels(surface, document.openings),
      );
      if (rectangles.reduce((total, items) => total + items.length, 0) > 8192)
        throw Error("PREVIEW_COMPLEXITY");
      const three = await import("three");
      const { OrbitControls } =
        await import("three/addons/controls/OrbitControls.js");
      if (disposed || !host.current) return;
      const renderer = new three.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = three.SRGBColorSpace;
      const scene = new three.Scene();
      scene.background = new three.Color("#e9e9e1");
      const model = new three.Group(),
        owned: Array<{ dispose: () => void }> = [];
      scene.add(model);
      scene.add(
        new three.HemisphereLight(
          0xffffff,
          0x71806a,
          document.lights.length ? 0.4 : 2.5,
        ),
      );
      const sun = new three.DirectionalLight(
        0xffffff,
        document.lights.length ? 0 : 3,
      );
      sun.position.set(20, 30, 25);
      scene.add(sun);
      const rooms = new Map<string, InstanceType<typeof three.Group>>(),
        surfaces = new Map<string, InstanceType<typeof three.Group>>();
      const pose = (
        target: InstanceType<typeof three.Object3D>,
        transform: Document["rooms"][number]["transform"],
      ) => {
        target.position.fromArray(transform.position);
        target.quaternion.fromArray(transform.rotation);
        target.scale.fromArray(transform.scale);
      };
      for (const room of document.rooms) {
        const group = new three.Group();
        pose(group, room.transform);
        rooms.set(room.id.toLowerCase(), group);
        model.add(group);
        const box = new three.BoxGeometry(
            room.dimensions.width,
            room.dimensions.height,
            room.dimensions.depth,
          ),
          edges = new three.EdgesGeometry(box);
        const material = new three.LineBasicMaterial({
          color:
            selection?.kind === "room" && selection.id === room.id
              ? "#765723"
              : "#829180",
        });
        const outline = new three.LineSegments(edges, material);
        outline.position.y = room.dimensions.height / 2;
        group.add(outline);
        owned.push(box, edges, material);
      }
      document.surfaces.forEach((surface, index) => {
        const group = new three.Group();
        pose(group, surface.transform);
        surfaces.set(surface.id.toLowerCase(), group);
        rooms.get(surface.roomId.toLowerCase())?.add(group);
        const looks = appearance(surface.id),
          material = new three.MeshStandardMaterial({
            color: new three.Color().setRGB(
              ...looks.baseColor,
              three.SRGBColorSpace,
            ),
            roughness: looks.roughness,
            metalness: looks.metalness,
            side: three.DoubleSide,
          });
        owned.push(material);
        for (const rectangle of rectangles[index]!) {
          const geometry = new three.PlaneGeometry(
              rectangle.width,
              rectangle.height,
            ),
            mesh = new three.Mesh(geometry, material);
          mesh.position.set(rectangle.x, rectangle.y, 0);
          group.add(mesh);
          owned.push(geometry);
        }
        if (selection?.kind === "surface" && selection.id === surface.id) {
          const shape = new three.PlaneGeometry(
              surface.dimensions.width,
              surface.dimensions.height,
            ),
            edges = new three.EdgesGeometry(shape),
            line = new three.LineBasicMaterial({ color: "#765723" });
          group.add(new three.LineSegments(edges, line));
          owned.push(shape, edges, line);
        }
      });
      for (const opening of document.openings) {
        const geometry = new three.PlaneGeometry(
            opening.dimensions.width,
            opening.dimensions.height,
          ),
          edges = new three.EdgesGeometry(geometry);
        const material = new three.LineBasicMaterial({
            color:
              selection?.kind === "opening" && selection.id === opening.id
                ? "#d45222"
                : "#203d2c",
          }),
          line = new three.LineSegments(edges, material);
        line.position.set(opening.offset[0], opening.offset[1], 0.002);
        surfaces.get(opening.surfaceId.toLowerCase())?.add(line);
        owned.push(geometry, edges, material);
      }
      const placements = new Map<string, InstanceType<typeof three.Group>>();
      for (const placement of document.placements) {
        const artwork = document.artworks.find(
          (a) =>
            a.revisionId.toLowerCase() ===
            placement.artworkRevisionId.toLowerCase(),
        );
        if (!artwork) continue;
        const group = new three.Group();
        pose(group, placement.transform);
        rooms.get(placement.roomId.toLowerCase())?.add(group);
        placements.set(placement.id.toLowerCase(), group);
        const geometry = new three.BoxGeometry(
          artwork.dimensions.width,
          artwork.dimensions.height,
          artwork.dimensions.depth ?? 0.01,
        );
        const edges = new three.EdgesGeometry(geometry),
          material = new three.LineDashedMaterial({
            color: 0x9a623b,
            dashSize: 0.08,
            gapSize: 0.05,
          });
        const bounds = new three.LineSegments(edges, material);
        bounds.computeLineDistances();
        group.add(bounds);
        owned.push(geometry, edges, material);
      }
      for (const item of document.lights) {
        const color = new three.Color().setRGB(
          ...item.color,
          three.LinearSRGBColorSpace,
        );
        const light =
          item.type === "spot"
            ? new three.SpotLight(
                color,
                item.intensity,
                0,
                (item.beamAngle ?? 0.6) / 2,
              )
            : item.type === "directional"
              ? new three.DirectionalLight(color, item.intensity)
              : new three.PointLight(color, item.intensity);
        pose(light, item.transform);
        rooms.get(item.roomId.toLowerCase())?.add(light);
        if (
          light instanceof three.SpotLight ||
          light instanceof three.DirectionalLight
        ) {
          const target = item.targetPlacementId
            ? placements.get(item.targetPlacementId.toLowerCase())
            : undefined;
          if (target) light.target = target;
          else {
            const aimed = new three.Object3D();
            aimed.position
              .copy(light.position)
              .add(
                new three.Vector3(0, 0, -1).applyQuaternion(light.quaternion),
              );
            rooms.get(item.roomId.toLowerCase())?.add(aimed);
            light.target = aimed;
          }
        }
      }
      model.updateMatrixWorld(true);
      const bounds = new three.Box3().setFromObject(model),
        center = bounds.getCenter(new three.Vector3()),
        size = bounds.getSize(new three.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 1),
        camera = new three.PerspectiveCamera(
          45,
          1,
          extent / 1000,
          extent * 100,
        );
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.minDistance = extent / 20;
      controls.maxDistance = extent * 10;
      const render = () => {
        if (!disposed) renderer.render(scene, camera);
      };
      const view = (
        kind:
          "isometric" | "top" | "front" | "left" | "right" | "start" | string,
      ) => {
        camera.up.set(0, 1, 0);
        controls.target.copy(center);
        const savedCamera =
          kind === "start"
            ? presentationFor(document).startCamera
            : presentationFor(document).viewpoints.find((v) => v.id === kind);
        if (savedCamera) {
          const room = rooms.get(savedCamera.roomId.toLowerCase());
          camera.position.copy(
            room
              ? room.localToWorld(new three.Vector3(...savedCamera.position))
              : new three.Vector3(...savedCamera.position),
          );
          controls.target.copy(
            room
              ? room.localToWorld(new three.Vector3(...savedCamera.target))
              : new three.Vector3(...savedCamera.target),
          );
          camera.fov = savedCamera.fov;
          camera.updateProjectionMatrix();
        } else if (kind === "front" && selection) {
          const surfaceId =
            selection.kind === "surface"
              ? selection.id
              : selection.kind === "opening"
                ? document.openings.find((item) => item.id === selection.id)
                    ?.surfaceId
                : undefined;
          const selected = surfaceId
            ? surfaces.get(surfaceId.toLowerCase())
            : undefined;
          if (selected) {
            const point = selected.getWorldPosition(new three.Vector3()),
              rotation = selected.getWorldQuaternion(new three.Quaternion());
            const normal = new three.Vector3(0, 0, 1).applyQuaternion(rotation);
            const surface = document.surfaces.find(
              (item) => item.id.toLowerCase() === surfaceId?.toLowerCase(),
            );
            const room = document.rooms.find(
              (item) => item.id.toLowerCase() === surface?.roomId.toLowerCase(),
            );
            const owner = room ? rooms.get(room.id.toLowerCase()) : undefined;
            if (room && owner) {
              const roomCenter = owner.localToWorld(
                new three.Vector3(0, room.dimensions.height / 2, 0),
              );
              if (normal.dot(point.clone().sub(roomCenter)) < 0)
                normal.negate();
            }
            camera.position
              .copy(point)
              .add(normal.multiplyScalar(extent * 1.6));
            camera.up.copy(
              new three.Vector3(0, 1, 0).applyQuaternion(rotation),
            );
            controls.target.copy(point);
          } else
            camera.position
              .copy(center)
              .add(new three.Vector3(0, extent * 0.4, extent * 1.8));
        } else if (kind === "top") {
          camera.position.copy(center).add(new three.Vector3(0, extent * 2, 0));
          camera.up.set(0, 0, -1);
        } else if (kind === "left" || kind === "right") {
          const delta = camera.position.clone().sub(controls.target);
          delta.applyAxisAngle(
            new three.Vector3(0, 1, 0),
            kind === "left" ? -Math.PI / 6 : Math.PI / 6,
          );
          camera.position.copy(controls.target).add(delta);
        } else
          camera.position
            .copy(center)
            .add(new three.Vector3(extent * 1.2, extent * 0.9, extent * 1.4));
        camera.lookAt(controls.target);
        controls.update();
        render();
      };
      const resize = () => {
        if (!host.current) return;
        const width = Math.max(host.current.clientWidth, 1),
          height = 360;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      };
      renderer.domElement.setAttribute("aria-label", "전시 공간 3D 미리보기");
      renderer.domElement.setAttribute("role", "img");
      const lost = (event: Event) => {
        event.preventDefault();
        setReady(false);
        setMessage(
          "3D 그래픽 연결이 중단되었습니다. 작품 metadata와 저장본은 유지됩니다. JSON과 숫자 편집을 사용할 수 있습니다.",
        );
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      host.current.replaceChildren(renderer.domElement);
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      controls.addEventListener("change", render);
      action.current = view;
      resize();
      view("isometric");
      setMessage(
        `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length}. 작품 bounds는 실제 치수입니다. 작품 derivative 미사용: metadata만 표시합니다.`,
      );
      setReady(true);
      release = () => {
        action.current = null;
        observer.disconnect();
        controls.dispose();
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        for (const resource of owned) resource.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      let rendered = 0,
        unavailable = 0;
      const sources = new Map<
        string,
        Promise<InstanceType<typeof three.Object3D>>
      >();
      const loadArtwork = async (artwork: Document["artworks"][number]) => {
        const binding = artwork.extensions?.["org.exhibitos.studio/cms"];
        if (
          !session ||
          !binding ||
          binding.tenantId !== session.tenantId ||
          typeof binding.artworkId !== "string"
        )
          throw Error("DERIVATIVE_UNAVAILABLE");
        const base = `/api/v1/tenants/${session.tenantId}`;
        const meta = await fetch(
          `${base}/studio/artworks/${encodeURIComponent(binding.artworkId)}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
          },
        );
        if (!meta.ok) throw Error("DERIVATIVE_UNAUTHORIZED");
        const bridge = (await meta.json()) as {
          artwork: Document["artworks"][number];
          previewUrl: string;
        };
        if (
          bridge.artwork.revisionId !== artwork.revisionId ||
          bridge.previewUrl !==
            `${base}/cms/artworks/${binding.artworkId}/preview`
        )
          throw Error("DERIVATIVE_REVISION_CHANGED");
        const response = await fetch(bridge.previewUrl, {
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) throw Error("DERIVATIVE_UNAVAILABLE");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 32 * 1024 * 1024 || disposed)
          throw Error("DERIVATIVE_UNAVAILABLE");
        let object: InstanceType<typeof three.Object3D>;
        if (artwork.artworkType === "image") {
          const bitmap = await createImageBitmap(
            new Blob([bytes], { type: "image/png" }),
          );
          if (disposed) {
            bitmap.close();
            throw Error("DISPOSED");
          }
          const texture = new three.Texture(bitmap);
          texture.colorSpace = three.SRGBColorSpace;
          texture.needsUpdate = true;
          owned.push(texture, { dispose: () => bitmap.close() });
          const geometry = new three.PlaneGeometry(
            artwork.dimensions.width,
            artwork.dimensions.height,
          );
          const material = new three.MeshStandardMaterial({
            map: texture,
            side: three.DoubleSide,
            roughness: 0.8,
          });
          owned.push(geometry, material);
          object = new three.Mesh(geometry, material);
        } else {
          const { GLTFLoader } =
            await import("three/addons/loaders/GLTFLoader.js");
          const manager = new three.LoadingManager();
          manager.setURLModifier(() => {
            throw Error("EXTERNAL_RESOURCE_REJECTED");
          });
          const gltf = await new GLTFLoader(manager).parseAsync(bytes, "");
          gltf.scene.traverse((node) => {
            if (node instanceof three.Mesh) {
              owned.push(node.geometry);
              for (const material of Array.isArray(node.material)
                ? node.material
                : [node.material]) {
                owned.push(material);
                for (const value of Object.values(material))
                  if (value instanceof three.Texture) owned.push(value);
              }
            }
          });
          if (disposed) {
            gltf.scene.traverse((node) => {
              if (node instanceof three.Mesh) {
                node.geometry.dispose();
                for (const material of Array.isArray(node.material)
                  ? node.material
                  : [node.material]) {
                  for (const value of Object.values(material))
                    if (value instanceof three.Texture) value.dispose();
                  material.dispose();
                }
              }
            });
            throw Error("DISPOSED");
          }
          object = gltf.scene;
          const bounds = new three.Box3().setFromObject(object),
            center = bounds.getCenter(new three.Vector3()),
            size = bounds.getSize(new three.Vector3());
          if (Math.min(size.x, size.y, size.z) <= 0)
            throw Error("DERIVATIVE_DIMENSIONS");
          // Qualified derivatives are centered and calibrated to the approved physical dimensions.
          const normalized = new three.Group();
          normalized.scale.set(
            artwork.dimensions.width / size.x,
            artwork.dimensions.height / size.y,
            (artwork.dimensions.depth ?? size.z) / size.z,
          );
          object.position.sub(center);
          normalized.add(object);
          object = normalized;
        }
        return object;
      };
      for (const placement of document.placements) {
        const artwork = document.artworks.find(
          (a) =>
            a.revisionId.toLowerCase() ===
            placement.artworkRevisionId.toLowerCase(),
        );
        const group = placements.get(placement.id.toLowerCase());
        if (!artwork || !group) continue;
        try {
          let source = sources.get(artwork.revisionId);
          if (!source) {
            source = loadArtwork(artwork);
            sources.set(artwork.revisionId, source);
          }
          const object = await source;
          if (disposed) return;
          const bounds = group.children[0];
          if (bounds) group.remove(bounds);
          group.add(object.clone(true));
          rendered++;
          render();
        } catch {
          unavailable++;
        }
        if (!disposed)
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${rendered}개 · bytes 사용 불가 ${unavailable}개 (점선은 실제 치수 metadata bounds).`,
          );
      }
    };
    void build().catch((error) => {
      if (!disposed)
        setMessage(
          error instanceof Error && error.message === "PREVIEW_COMPLEXITY"
            ? "미리보기 한도(방 32개, 표면 256개, 개구부·작품 배치·조명 각각 128개, 사각 패널 8192개, 좌표·치수 10,000m)를 초과했습니다. 문서는 유지됩니다."
            : "3D 미리보기를 표시할 수 없습니다. WebGL 지원을 확인하세요. 숫자 편집과 JSON 백업은 계속 사용할 수 있습니다.",
        );
    });
    return () => {
      disposed = true;
      abort.abort();
      release();
    };
  }, [document, selection, appearance, session]);
  return (
    <figure className="geometry-preview">
      <div ref={host} />
      <figcaption data-testid="geometry-render-state">{message}</figcaption>
      <div className="cms-actions">
        <button
          disabled={!ready || !presentationFor(document).startCamera}
          onClick={() => action.current?.("start")}
        >
          시작 camera 보기
        </button>
        {presentationFor(document).viewpoints.map((v) => (
          <button
            key={v.id}
            disabled={!ready}
            onClick={() => action.current?.(v.id)}
          >
            viewpoint 보기 {v.name}
          </button>
        ))}
        <button disabled={!ready} onClick={() => action.current?.("isometric")}>
          전체 공간 보기
        </button>
        <button disabled={!ready} onClick={() => action.current?.("front")}>
          선택 표면 정면
        </button>
        <button disabled={!ready} onClick={() => action.current?.("top")}>
          위에서 보기
        </button>
        <button disabled={!ready} onClick={() => action.current?.("left")}>
          시점 왼쪽 회전
        </button>
        <button disabled={!ready} onClick={() => action.current?.("right")}>
          시점 오른쪽 회전
        </button>
      </div>
      <p className="cms-note">
        사각형 표면과 실제 사각 개구부의 편집 미리보기입니다.
        곡선벽·계단·충돌·보행 가능성·물리적 조도 측정은 지원하지 않습니다.
        저장된 point/spot 조명은 실시간 편집용 근사입니다. 마우스 없이 위
        버튼으로 시점을 바꿀 수 있습니다.
      </p>
    </figure>
  );
}
