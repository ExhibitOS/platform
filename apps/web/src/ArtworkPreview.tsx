import { useEffect, useRef, useState } from "react";

export function ArtworkPreview({
  url,
  mime,
  credit,
}: {
  url: string;
  mime: string;
  credit: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rotate = useRef<((direction: number) => void) | null>(null);
  const [message, setMessage] = useState("미리보기를 불러오는 중…");
  const [image, setImage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false,
      objectUrl: string | undefined,
      cleanup = () => {};
    const abort = new AbortController();
    setImage(null);
    setReady(false);
    setMessage("미리보기를 불러오는 중…");
    async function load() {
      const response = await fetch(url, {
        credentials: "same-origin",
        signal: abort.signal,
      });
      if (!response.ok) throw Error(`PREVIEW_${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 32 * 1024 * 1024) throw Error("PREVIEW_SIZE");
      if (disposed) return;
      if (mime === "image/png") {
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: "image/png" }),
        );
        setImage(objectUrl);
        setReady(true);
        setMessage("워터마크가 포함된 전시용 이미지입니다.");
        return;
      }
      if (mime !== "model/gltf-binary") throw Error("PREVIEW_TYPE");
      const [three, { GLTFLoader }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
      ]);
      if (disposed || !host.current) return;
      const manager = new three.LoadingManager();
      manager.setURLModifier(() => {
        throw Error("EXTERNAL_RESOURCE_REJECTED");
      });
      const model = await new GLTFLoader(manager).parseAsync(bytes, "");
      const releaseModel = () =>
        model.scene.traverse((node) => {
          if (node instanceof three.Mesh) {
            node.geometry.dispose();
            for (const material of Array.isArray(node.material)
              ? node.material
              : [node.material])
              material.dispose();
          }
        });
      if (disposed || !host.current) {
        releaseModel();
        return;
      }
      let renderer: InstanceType<typeof three.WebGLRenderer>;
      try {
        renderer = new three.WebGLRenderer({ antialias: true, alpha: false });
      } catch (error) {
        releaseModel();
        throw error;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const scene = new three.Scene();
      scene.background = new three.Color("#e9e9e1");
      const bounds = new three.Box3().setFromObject(model.scene),
        center = bounds.getCenter(new three.Vector3()),
        size = bounds.getSize(new three.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 0.01);
      model.scene.position.sub(center);
      scene.add(model.scene);
      scene.add(new three.HemisphereLight(0xffffff, 0x48503d, 2));
      const light = new three.DirectionalLight(0xffffff, 3);
      light.position.set(extent, extent * 2, extent * 3);
      scene.add(light);
      const camera = new three.PerspectiveCamera(
        45,
        1,
        extent / 100,
        extent * 100,
      );
      camera.position.set(0, extent * 0.3, extent * 2.5);
      camera.lookAt(0, 0, 0);
      const render = () => {
        if (!disposed) renderer.render(scene, camera);
      };
      const resize = () => {
        if (!host.current) return;
        const width = Math.max(host.current.clientWidth, 1),
          height = 320;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      };
      host.current.appendChild(renderer.domElement);
      renderer.domElement.setAttribute(
        "aria-label",
        "승인된 GLB의 전시용 3D 미리보기",
      );
      const lost = (event: Event) => {
        event.preventDefault();
        setReady(false);
        setMessage(
          "3D 그래픽을 사용할 수 없습니다. 작품 설명과 실제 치수를 이용해 주세요.",
        );
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      resize();
      rotate.current = (direction) => {
        model.scene.rotation.y += (direction * Math.PI) / 4;
        render();
      };
      cleanup = () => {
        observer.disconnect();
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        renderer.domElement.remove();
        releaseModel();
        renderer.dispose();
        renderer.forceContextLoss();
        rotate.current = null;
      };
      setReady(true);
      setMessage("전시용 3D 미리보기. 아래 버튼으로 회전할 수 있습니다.");
    }
    void load().catch(() => {
      if (!disposed)
        setMessage(
          "미리보기를 사용할 수 없습니다. 전시 권리·승인 상태 또는 그래픽 지원을 확인해 주세요. 원본으로 대체하지 않습니다.",
        );
    });
    return () => {
      disposed = true;
      abort.abort();
      cleanup();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, mime]);
  return (
    <figure className="cms-preview">
      <div ref={host}>
        {image && <img src={image} alt={`전시용 작품 이미지 — ${credit}`} />}
      </div>
      <figcaption>
        {message}
        <br />
        {credit}
      </figcaption>
      {ready && mime === "model/gltf-binary" && (
        <div className="cms-actions">
          <button type="button" onClick={() => rotate.current?.(-1)}>
            왼쪽 회전
          </button>
          <button type="button" onClick={() => rotate.current?.(1)}>
            오른쪽 회전
          </button>
        </div>
      )}
      <p className="cms-note">
        브라우저에 전달된 전시 데이터는 복제될 수 있습니다. 워터마크와 원본 접근
        제한은 DRM 보장이 아닙니다.
      </p>
    </figure>
  );
}
