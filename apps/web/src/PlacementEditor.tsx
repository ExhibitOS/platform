import { useEffect, useState } from "react";
import type { Exhibition } from "@exhibitos/spec";
import type { GeometryCommand } from "./geometry/model";
import { newPlacement, newLight, kelvinColor, placementDimensions } from "./placement/model";
import { request, failureMessage } from "./cms-client";
import type { Session } from "./cms-client";
import { presentationFor } from "@exhibitos/studio-contract";

type Vector = [number, number, number];
function VectorFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vector;
  onChange: (v: Vector) => void;
}) {
  return (
    <div className="geometry-fields">
      {["X", "Y", "Z"].map((axis, i) => (
        <label key={axis}>
          {label} {axis}
          <input
            aria-label={`${label} ${axis}`}
            type="number"
            step="0.1"
            value={Number.isFinite(value[i]) ? value[i] : ""}
            onChange={(e) => {
              const next = [...value] as Vector;
              next[i] = e.target.value === "" ? NaN : Number(e.target.value);
              onChange(next);
            }}
          />
        </label>
      ))}
    </div>
  );
}
export function PlacementEditor({
  document,
  execute,
  session,
  disabled,
}: {
  document: Exhibition;
  execute: (command: GeometryCommand) => void;
  session: Session | null;
  disabled: boolean;
}) {
  const [artworkId, setArtworkId] = useState(""),
    [importError, setImportError] = useState(""),
    [loading, setLoading] = useState(false);
  const [artwork, setArtwork] = useState(""),
    [room, setRoom] = useState(document.rooms[0]?.id ?? ""),
    [selected, setSelected] = useState(""),
    [wall, setWall] = useState(""),
    [offset, setOffset] = useState<Vector>([0, 0, 0]),
    [snap, setSnap] = useState("0.1");
  const placement = document.placements.find((p) => p.id === selected);
  const [position, setPosition] = useState<Vector>([0, 0, 0]),
    [rotation, setRotation] = useState<[number, number, number, number]>([
      0, 0, 0, 1,
    ]);
  const [lightId, setLightId] = useState(""),
    [lightPosition, setLightPosition] = useState<Vector>([0, 3, 2]),
    [lightColor, setLightColor] = useState("#ffffff"),
    [intensity, setIntensity] = useState("100"),
    [target, setTarget] = useState(""),
    [beam, setBeam] = useState("0.6");
  const [lightingError,setLightingError]=useState("");
  useEffect(()=>{if(!document.rooms.some(r=>r.id===room))setRoom(document.rooms[0]?.id??"");},[document.rooms,room]);
  const [areaWidth,setAreaWidth]=useState("1"),[areaHeight,setAreaHeight]=useState("1"),[temperature,setTemperature]=useState("6500");
  const light = document.lights.find((l) => l.id === lightId);
  const presentation = presentationFor(document);
  const [cameraPosition, setCameraPosition] = useState<Vector>([0, 1.6, 3]),
    [cameraTarget, setCameraTarget] = useState<Vector>([0, 1.6, 0]),
    [fov, setFov] = useState("45"),
    [viewName, setViewName] = useState("관람 시점"),
    [credits, setCredits] = useState(presentation.credits),
    [title, setTitle] = useState(document.title),
    [routeName, setRouteName] = useState("추천 동선"),
    [routePoints, setRoutePoints] = useState("[]");
  useEffect(() => {
    if (placement) {
      setPosition([...placement.transform.position]);
      setRotation([...placement.transform.rotation]);
      setRoom(placement.roomId);
    }
  }, [placement]);
  useEffect(() => {
    if (light) {
      setLightPosition([...light.transform.position]);
      setIntensity(String(light.intensity));
      setTarget(light.targetPlacementId ?? "");
      setBeam(String(light.beamAngle ?? 0.6));setAreaWidth(String(light.dimensions?.width??1));setAreaHeight(String(light.dimensions?.height??1));
      setLightColor(
        `#${light.color
          .map((v) =>
            Math.round(v * 255)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
      );
    }
  }, [light]);
  useEffect(() => {
    setCredits(presentation.credits);
    setTitle(document.title);
  }, [presentation.credits, document.title]);
  const [viewDistance, setViewDistance] = useState("2"),
    [eyeHeight, setEyeHeight] = useState("1.6");
  useEffect(() => {
    if (presentation.startCamera) {
      setCameraPosition([...presentation.startCamera.position]);
      setCameraTarget([...presentation.startCamera.target]);
      setFov(String(presentation.startCamera.fov));
    }
  }, [document.extensions]);
  const camera = () => ({
    roomId: room,
    position: cameraPosition,
    target: cameraTarget,
    fov: Number(fov),
  });
  async function importArtwork() {
    if (!session) return;
    setLoading(true);
    setImportError("");
    try {
      const result = await request<{ artwork: Exhibition["artworks"][number] }>(
        `/api/v1/tenants/${session.tenantId}/studio/artworks/${encodeURIComponent(artworkId)}`,
        session,
      );
      execute({ type: "add-artwork", artwork: result.artwork });
      setArtwork(result.artwork.revisionId);
    } catch (e) {
      setImportError(failureMessage(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="placement-editor" aria-label="작품·조명·관람 편집">
      <h3>작품·조명·관람 편집</h3>
      <p className="cms-note">
        실제 치수와 meter 좌표를 사용합니다. 승인된 CMS metadata를 가져오려면
        아래에서 서버 계정을 확인하세요. 오프라인에서도 저장된 metadata를 편집할
        수 있습니다.
      </p>
      <fieldset disabled={disabled || loading}>
        <legend>작품 선택·배치</legend>
        <label>
          CMS 작품 ID
          <input
            aria-label="CMS 작품 ID"
            value={artworkId}
            onChange={(e) => setArtworkId(e.target.value)}
          />
        </label>
        <button
          disabled={!session || !artworkId || !navigator.onLine}
          onClick={() => void importArtwork()}
        >
          승인된 CMS 작품 가져오기
        </button>
        <p role="alert">{importError}</p>
        <label>
          배치할 작품
          <select
            aria-label="배치할 작품"
            value={artwork}
            onChange={(e) => setArtwork(e.target.value)}
          >
            <option value="">작품 선택</option>
            {document.artworks.map((a) => (
              <option key={a.revisionId} value={a.revisionId}>
                {a.metadata.title} · {a.dimensions.width} ×{" "}
                {a.dimensions.height} m
              </option>
            ))}
          </select>
        </label>
        <label>
          배치·camera 소유 방
          <select
            aria-label="배치·camera 소유 방"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            {document.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!artwork || !room}
          onClick={() => {
            const a = document.artworks.find((a) => a.revisionId === artwork);
            if (a) {
              const p = newPlacement(a, room);
              execute({ type: "add-placement", placement: p });
              setSelected(p.id);
            }
          }}
        >
          실제 크기로 작품 배치
        </button>
        <label>
          작품 배치 선택
          <select
            aria-label="작품 배치 선택"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">배치 선택</option>
            {document.placements.map((p) => (
              <option key={p.id} value={p.id}>
                {
                  document.artworks.find(
                    (a) => a.revisionId === p.artworkRevisionId,
                  )?.metadata.title
                }{" "}
                · {p.id}
              </option>
            ))}
          </select>
        </label>
        {placement && (
          <>
            <VectorFields
              label="작품 위치 (m)"
              value={position}
              onChange={setPosition}
            />
            <div className="geometry-fields">
              {["X", "Y", "Z", "W"].map((axis, i) => (
                <label key={axis}>
                  작품 회전 {axis}
                  <input
                    aria-label={`작품 회전 ${axis}`}
                    type="number"
                    step="0.01"
                    value={Number.isFinite(rotation[i]) ? rotation[i] : ""}
                    onChange={(e) => {
                      const next = [...rotation] as typeof rotation;
                      next[i] =
                        e.target.value === "" ? NaN : Number(e.target.value);
                      setRotation(next);
                    }}
                  />
                </label>
              ))}
            </div>
            <button
              onClick={() =>
                execute({
                  type: "set-placement",
                  id: placement.id,
                  placement: {
                    roomId: room,
                    artworkRevisionId: placement.artworkRevisionId,
                    assetId: placement.assetId,
                    transform: {
                      position,
                      rotation,
                      scale: [...placement.transform.scale],
                    },
                  },
                })
              }
            >
              작품 수동 위치·회전 적용
            </button>
            <button
              onClick={() =>
                execute({ type: "remove-placement", id: placement.id })
              }
            >
              선택 작품 배치 삭제
            </button>
            <label>
              정렬할 벽
              <select
                aria-label="정렬할 벽"
                value={wall}
                onChange={(e) => setWall(e.target.value)}
              >
                <option value="">벽 선택</option>
                {document.surfaces
                  .filter(
                    (s) =>
                      s.type === "wall" &&
                      s.roomId.toLowerCase() === room.toLowerCase(),
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
              </select>
            </label>
            <VectorFields
              label="벽 중심 offset (m)"
              value={offset}
              onChange={setOffset}
            />
            <label>
              snap 간격 (m)
              <input
                aria-label="snap 간격 (m)"
                type="number"
                step="0.1"
                value={snap}
                onChange={(e) => setSnap(e.target.value)}
              />
            </label>
            <button
              disabled={!wall}
              onClick={() =>
                execute({
                  type: "align-placement",
                  id: placement.id,
                  surfaceId: wall,
                  offset: [offset[0], offset[1]],
                  snap: Number(snap),
                })
              }
            >
              벽 내부 정렬·snap 적용
            </button>
          </>
        )}
        <ul className="placement-credits">
          {document.placements.map((p) => {
            const a = document.artworks.find(
              (a) => a.revisionId === p.artworkRevisionId,
            );
            const size = a ? placementDimensions(a, p) : null;
            return (
              <li key={p.id}>
                {a?.metadata.title} · {a?.rights.creditLine} · {size?.width} ×{" "}
                {size?.height} × {size?.depth ?? 0} m
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>기본 조명·spotlight</legend><p role="alert">{lightingError}</p>
        <button
          onClick={() => {
            const l = newLight(room, "point");
            execute({ type: "add-light", light: l });
            setLightId(l.id);
          }}
        >
          point 조명 추가
        </button>
        <button
          onClick={() => {
            const l = newLight(room, "spot");
            execute({ type: "add-light", light: l });
            setLightId(l.id);
          }}
        >
          spotlight 추가
        </button>
        {(["directional","area"] as const).map(type=><button key={type} onClick={()=>{const l=newLight(room,type);execute({type:"add-light",light:l});setLightId(l.id);}}>{type} 조명 추가</button>)}
        <label>
          조명 선택
          <select
            aria-label="조명 선택"
            value={lightId}
            onChange={(e) => setLightId(e.target.value)}
          >
            <option value="">조명 선택</option>
            {document.lights.map((l) => (
              <option key={l.id} value={l.id}>
                {l.type} · {l.id}
              </option>
            ))}
          </select>
        </label>
        {light && (
          <>
            <VectorFields
              label="조명 위치 (m)"
              value={lightPosition}
              onChange={setLightPosition}
            />
            <label>
              조명 색상
              <input
                aria-label="조명 색상"
                type="color"
                value={lightColor}
                onChange={(e) => setLightColor(e.target.value)}
              />
            </label>
            <label>색온도 근사(K)<input aria-label="색온도 근사(K)" type="number" value={temperature} onChange={e=>setTemperature(e.target.value)}/></label><button onClick={()=>{try{setLightColor(kelvinColor(Number(temperature)));}catch(e){setLightingError(e instanceof Error?e.message:'색온도 오류');}}}>색온도 색상 적용</button>
            {light.type==='area'&&<><label>Area 폭(m)<input aria-label="Area 폭(m)" type="number" value={areaWidth} onChange={e=>setAreaWidth(e.target.value)}/></label><label>Area 높이(m)<input aria-label="Area 높이(m)" type="number" value={areaHeight} onChange={e=>setAreaHeight(e.target.value)}/></label></>}
            <label>
              조명 밝기 ({light.unit})
              <input
                aria-label={`조명 밝기 (${light.unit})`}
                type="number"
                value={intensity}
                onChange={(e) => setIntensity(e.target.value)}
              />
            </label>
            {light.type === "spot" && (
              <>
                <label>
                  spotlight target
                  <select
                    aria-label="spotlight target"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">회전 방향 사용</option>
                    {document.placements.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  spotlight beam (radian)
                  <input
                    aria-label="spotlight beam (radian)"
                    type="number"
                    step="0.1"
                    value={beam}
                    onChange={(e) => setBeam(e.target.value)}
                  />
                </label>
              </>
            )}
            <button
              onClick={() =>
                execute({
                  type: "set-light",
                  id: light.id,
                  light: {
                    ...(Object.fromEntries(
                      Object.entries(light).filter(
                        ([key]) => key !== "targetPlacementId",
                      ),
                    ) as typeof light),
                    transform: { ...light.transform, position: lightPosition },
                    color: [1, 3, 5].map(
                      (i) => parseInt(lightColor.slice(i, i + 2), 16) / 255,
                    ) as Vector,
                    intensity: Number(intensity),
                    ...(light.type==='area'?{dimensions:{width:Number(areaWidth),height:Number(areaHeight)}}:{}),
                    ...(light.type === "spot"
                      ? {
                          beamAngle: Number(beam),
                          ...(target ? { targetPlacementId: target } : {}),
                        }
                      : {}),
                  },
                })
              }
            >
              조명 속성 적용
            </button>
            <button
              onClick={() => execute({ type: "remove-light", id: light.id })}
            >
              선택 조명 삭제
            </button>
          </>
        )}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>시작 camera·viewpoint·제목·credits</legend>
        <label>
          관람 거리 (m)
          <input
            aria-label="관람 거리 (m)"
            type="number"
            value={viewDistance}
            onChange={(e) => setViewDistance(e.target.value)}
          />
        </label>
        <label>
          관람 높이 (m)
          <input
            aria-label="관람 높이 (m)"
            type="number"
            value={eyeHeight}
            onChange={(e) => setEyeHeight(e.target.value)}
          />
        </label>
        <button
          disabled={!placement}
          onClick={() => {
            if (!placement) return;
            const distance = Number(viewDistance),
              height = Number(eyeHeight);
            if (
              !Number.isFinite(distance) ||
              distance <= 0 ||
              !Number.isFinite(height)
            ) {
              setImportError("관람 거리와 높이를 확인하세요.");
              return;
            }
            const [x, y, z] = placement.transform.position;
            setCameraPosition([x, height, z + distance]);
            setCameraTarget([x, y, z]);
            setRoom(placement.roomId);
          }}
        >
          선택 작품 관람 camera 준비
        </button>
        <VectorFields
          label="camera 위치 (m)"
          value={cameraPosition}
          onChange={setCameraPosition}
        />
        <VectorFields
          label="camera target (m)"
          value={cameraTarget}
          onChange={setCameraTarget}
        />
        <label>
          camera FOV
          <input
            aria-label="camera FOV"
            type="number"
            value={fov}
            onChange={(e) => setFov(e.target.value)}
          />
        </label>
        <button
          onClick={() =>
            execute({
              type: "set-presentation",
              presentation: { ...presentation, startCamera: camera() },
            })
          }
        >
          시작 camera 적용
        </button>
        <label>
          viewpoint 이름
          <input
            aria-label="viewpoint 이름"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
        </label>
        <button
          onClick={() =>
            execute({
              type: "set-presentation",
              presentation: {
                ...presentation,
                viewpoints: [
                  ...presentation.viewpoints,
                  { ...camera(), id: crypto.randomUUID(), name: viewName },
                ],
              },
            })
          }
        >
          viewpoint 추가
        </button>
        <ul>
          {presentation.viewpoints.map((v) => (
            <li key={v.id}>
              {v.name}
              <button
                onClick={() =>
                  execute({
                    type: "set-presentation",
                    presentation: {
                      ...presentation,
                      viewpoints: presentation.viewpoints.filter(
                        (p) => p.id !== v.id,
                      ),
                    },
                  })
                }
              >
                viewpoint 삭제 {v.name}
              </button>
            </li>
          ))}
        </ul>
        <label>
          편집 전시 제목
          <input
            aria-label="편집 전시 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button onClick={() => execute({ type: "set-title", title })}>
          제목 적용
        </button>
        <label>
          전시 credits
          <textarea
            aria-label="전시 credits"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
          />
        </label>
        <button
          onClick={() =>
            execute({
              type: "set-presentation",
              presentation: { ...presentation, credits },
            })
          }
        >
          credits 적용
        </button>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>선택 가능한 추천 동선</legend>
        <p>
          추천 동선을 저장해도 자유 시점 조작은 계속 사용할 수 있습니다.
          waypoint는 방 ID와 meter 위치를 사용합니다.
        </p>
        <label>
          동선 이름
          <input
            aria-label="동선 이름"
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
          />
        </label>
        <button
          onClick={() =>
            setRoutePoints(
              JSON.stringify(
                [
                  { roomId: room, position: cameraPosition },
                  { roomId: room, position: cameraTarget },
                ],
                null,
                2,
              ),
            )
          }
        >
          현재 camera로 waypoint 준비
        </button>
        <label>
          동선 waypoints JSON
          <textarea
            aria-label="동선 waypoints JSON"
            value={routePoints}
            onChange={(e) => setRoutePoints(e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            try {
              execute({
                type: "set-navigation",
                navigation: [
                  ...document.navigation,
                  {
                    id: crypto.randomUUID(),
                    name: routeName,
                    accessible: true,
                    waypoints: JSON.parse(routePoints),
                  },
                ],
              });
              setImportError("");
            } catch {
              setImportError("동선 JSON을 확인하세요.");
            }
          }}
        >
          추천 동선 추가
        </button>
        <ul>
          {document.navigation.map((r) => (
            <li key={r.id}>
              {r.name} · {r.waypoints.length} waypoint
              <button
                onClick={() =>
                  execute({
                    type: "set-navigation",
                    navigation: document.navigation.filter(
                      (n) => n.id !== r.id,
                    ),
                  })
                }
              >
                동선 삭제 {r.name}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
    </section>
  );
}
