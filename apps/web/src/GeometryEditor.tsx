import { materialFor } from "@exhibitos/studio-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "./drafts/store";
import {
  applyGeometryCommand,
  createGeometryState,
  undoGeometry,
  redoGeometry,
  newRoom,
  newSurface,
  newDoor,
  GeometryError,
} from "./geometry/model";
import type { GeometryCommand, GeometryState } from "./geometry/model";
import { PlacementEditor } from "./PlacementEditor";
import type { Session } from "./cms-client";
import { GeometryPreview } from "./GeometryPreview";
import type { GeometrySelection, SurfaceAppearance } from "./GeometryPreview";

type Document = Draft["candidate"];
type Pose = Document["rooms"][number]["transform"];
const identity: Pose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};
const numbers = (values: string[]) =>
  values.map((value) => {
    if (value.trim() === "" || !Number.isFinite(Number(value)))
      throw Error("숫자 입력은 비어 있지 않은 유한한 값이어야 합니다.");
    return Number(value);
  });
function PoseFields({
  pose,
  setPose,
}: {
  pose: Pose;
  setPose: (pose: Pose) => void;
}) {
  return (
    <>
      <div className="geometry-fields">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <label key={axis}>
            위치 {axis} (m)
            <input
              aria-label={`위치 ${axis} (m)`}
              type="number"
              step="0.1"
              value={
                Number.isFinite(pose.position[index])
                  ? pose.position[index]
                  : ""
              }
              onChange={(event) => {
                const next = structuredClone(pose);
                next.position[index] =
                  event.target.value === "" ? NaN : Number(event.target.value);
                setPose(next);
              }}
            />
          </label>
        ))}
      </div>
      <div className="geometry-fields">
        {(["X", "Y", "Z", "W"] as const).map((axis, index) => (
          <label key={axis}>
            회전 quaternion {axis}
            <input
              aria-label={`회전 quaternion ${axis}`}
              type="number"
              step="0.01"
              value={
                Number.isFinite(pose.rotation[index])
                  ? pose.rotation[index]
                  : ""
              }
              onChange={(event) => {
                const next = structuredClone(pose);
                next.rotation[index] =
                  event.target.value === "" ? NaN : Number(event.target.value);
                setPose(next);
              }}
            />
          </label>
        ))}
      </div>
      <p className="cms-note">
        위치는 소유 방 기준 meter입니다(방 자체는 전시 좌표). 회전은 정규화된
        XYZW quaternion이며 합산 제곱이 1이어야 합니다. 방·표면 scale은
        [1,1,1]로 고정합니다. 크기는 별도의 치수로 편집합니다.
      </p>
    </>
  );
}

export function GeometryEditor({
  candidate,
  onChange,
  disabled,
  session,
}: {
  candidate: Document;
  onChange: (document: Document) => void;
  disabled: boolean;
  session: Session | null;
}) {
  const [state, setState] = useState(() => createGeometryState(candidate)),
    stateRef = useRef<GeometryState>(state);
  const [selection, setSelection] = useState<GeometrySelection | null>(
      candidate.rooms[0] ? { kind: "room", id: candidate.rooms[0].id } : null,
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [dimensions, setDimensions] = useState(["12", "4", "8"]),
    [pose, setPose] = useState<Pose>(identity),
    [parent, setParent] = useState(""),
    [surfaceType, setSurfaceType] = useState<"wall" | "floor" | "ceiling">(
      "wall",
    ),
    [openingType, setOpeningType] = useState<"door" | "window">("door"),
    [offset, setOffset] = useState(["0", "0"]);
  const [color, setColor] = useState("#f4f1e8"),
    [roughness, setRoughness] = useState("0.8"),
    [metalness, setMetalness] = useState("0"),
    [secondDoor, setSecondDoor] = useState("");
  const document = state.present;
  useEffect(() => {
    if (
      JSON.stringify(candidate) !== JSON.stringify(stateRef.current.present)
    ) {
      const next = createGeometryState(candidate);
      stateRef.current = next;
      setState(next);
      setError("");
      setNotice(
        "JSON·복구·서버 적용으로 문서가 바뀌어 편집 undo 이력을 새로 시작했습니다. 저장된 로컬 이력은 유지됩니다.",
      );
    }
  }, [candidate]);
  useEffect(() => {
    if (!selection) return;
    const selected =
      selection.kind === "room"
        ? document.rooms.find((item) => item.id === selection.id)
        : selection.kind === "surface"
          ? document.surfaces.find((item) => item.id === selection.id)
          : document.openings.find((item) => item.id === selection.id);
    if (!selected) {
      setSelection(
        document.rooms[0] ? { kind: "room", id: document.rooms[0].id } : null,
      );
      return;
    }
    if (selection.kind === "room") {
      const room = selected as Document["rooms"][number];
      setName(room.name);
      setDimensions([
        String(room.dimensions.width),
        String(room.dimensions.height),
        String(room.dimensions.depth),
      ]);
      setPose(structuredClone(room.transform));
    }
    if (selection.kind === "surface") {
      const surface = selected as Document["surfaces"][number];
      setParent(
        document.rooms.find(
          (item) => item.id.toLowerCase() === surface.roomId.toLowerCase(),
        )?.id ?? surface.roomId,
      );
      setSurfaceType(surface.type);
      setDimensions([
        String(surface.dimensions.width),
        String(surface.dimensions.height),
      ]);
      setPose(structuredClone(surface.transform));
      const material = materialFor(document, surface.id);
      setColor(material.color);
      setRoughness(String(material.roughness));
      setMetalness(String(material.metalness));
    }
    if (selection.kind === "opening") {
      const opening = selected as Document["openings"][number];
      setParent(
        document.surfaces.find(
          (item) => item.id.toLowerCase() === opening.surfaceId.toLowerCase(),
        )?.id ?? opening.surfaceId,
      );
      setOpeningType(opening.type);
      setDimensions([
        String(opening.dimensions.width),
        String(opening.dimensions.height),
      ]);
      setOffset(opening.offset.map(String));
    }
  }, [selection, document]);
  const change = (next: GeometryState) => {
    stateRef.current = next;
    setState(next);
    onChange(next.present);
    setError("");
    setNotice(
      "유효한 공간 편집을 적용했습니다. 기존 로컬 CAS 자동 저장을 사용합니다.",
    );
  };
  const execute = (command: GeometryCommand) => {
    try {
      change(applyGeometryCommand(stateRef.current, command));
    } catch (problem) {
      setError(
        problem instanceof GeometryError
          ? `${problem.code}: ${JSON.stringify(problem.issues)}`
          : problem instanceof Error
            ? problem.message
            : "편집을 적용할 수 없습니다.",
      );
    }
  };
  const work = (action: () => void) => {
    setError("");
    try {
      action();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "입력을 확인하세요.",
      );
    }
  };
  const appearance = useCallback(
    (id: string): SurfaceAppearance => {
      const material = materialFor(document, id),
        hex = material.color;
      return {
        baseColor: [
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        ],
        roughness: material.roughness,
        metalness: material.metalness,
      };
    },
    [document],
  );
  const selectedRoom =
    selection?.kind === "room"
      ? document.rooms.find((item) => item.id === selection.id)
      : undefined;
  const selectedSurface =
    selection?.kind === "surface"
      ? document.surfaces.find((item) => item.id === selection.id)
      : undefined;
  const selectedOpening =
    selection?.kind === "opening"
      ? document.openings.find((item) => item.id === selection.id)
      : undefined;
  return (
    <section className="geometry-editor" aria-label="공간 편집기">
      <h2>공간 · 표면 · 개구부 편집</h2>
      <p className="cms-note">
        직사각형 방과 평면 벽·바닥·천장을 편집합니다. 곡선벽·계단은 지원하지
        않습니다. 문은 실제 사각 개구부이며 외부 출입문 또는 다른 방의 문과
        연결합니다. 충돌·보행 가능성을 보장하지 않습니다.
      </p>
      <p role="alert" data-testid="geometry-error">
        {error}
      </p>
      <p data-testid="geometry-status" className="cms-note">
        {notice}
      </p>
      <fieldset disabled={disabled}>
        <legend>선택과 명령</legend>
        <label>
          공간 요소 선택
          <select
            aria-label="공간 요소 선택"
            value={selection ? `${selection.kind}:${selection.id}` : ""}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(":");
              if (!id || !["room", "surface", "opening"].includes(kind ?? ""))
                return;
              setSelection({ kind: kind as GeometrySelection["kind"], id });
              setError("");
            }}
          >
            {document.rooms.map((item, index) => (
              <option key={item.id} value={`room:${item.id}`}>
                방 {index + 1} · {item.name}
              </option>
            ))}
            {document.surfaces.map((item, index) => (
              <option key={item.id} value={`surface:${item.id}`}>
                표면 {index + 1} · {item.type} · {item.id.slice(0, 8)}
              </option>
            ))}
            {document.openings.map((item, index) => (
              <option key={item.id} value={`opening:${item.id}`}>
                개구부 {index + 1} · {item.type} · {item.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <div className="cms-actions">
          <button
            disabled={!state.past.length}
            onClick={() => work(() => change(undoGeometry(stateRef.current)))}
          >
            공간 편집 undo
          </button>
          <button
            disabled={!state.future.length}
            onClick={() => work(() => change(redoGeometry(stateRef.current)))}
          >
            공간 편집 redo
          </button>
          <button
            onClick={() =>
              work(() => {
                const room = newRoom("새 방", {
                  width: 12,
                  height: 4,
                  depth: 8,
                });
                execute({ type: "add-room", room });
                setSelection({ kind: "room", id: room.id });
              })
            }
          >
            방 추가
          </button>
          {selectedRoom && (
            <button
              onClick={() =>
                execute({ type: "white-cube", roomId: selectedRoom.id })
              }
            >
              선택 방 white-cube 생성
            </button>
          )}
        </div>
        <p className="cms-note">
          undo/redo는 현재 열린 편집 세션의 최근 20개 명령입니다. 새로 열면
          저장된 로컬 이력으로 복구하세요. 기존 표면이 있는 방은 white-cube가
          덮어쓰지 않습니다.
        </p>
      </fieldset>
      {selection && (
        <fieldset disabled={disabled}>
          <legend>
            {selection.kind === "room"
              ? "방"
              : selection.kind === "surface"
                ? "표면"
                : "문·창문"}{" "}
            속성 · 명시적 적용
          </legend>
          <code className="geometry-id" data-testid="geometry-selected-id">
            {selection.id}
          </code>
          {selectedRoom && (
            <label>
              방 이름
              <input
                aria-label="방 이름"
                maxLength={512}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {selectedSurface && (
            <>
              <label>
                표면 소유 방
                <select
                  aria-label="표면 소유 방"
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  {document.rooms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                표면 종류
                <select
                  aria-label="표면 종류"
                  value={surfaceType}
                  onChange={(e) =>
                    setSurfaceType(e.target.value as typeof surfaceType)
                  }
                >
                  <option value="wall">벽</option>
                  <option value="floor">바닥</option>
                  <option value="ceiling">천장</option>
                </select>
              </label>
            </>
          )}
          {selectedOpening && (
            <>
              <label>
                개구부 소유 표면
                <select
                  aria-label="개구부 소유 표면"
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  {document.surfaces
                    .filter((item) => item.type === "wall")
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.id.slice(0, 8)} · wall
                      </option>
                    ))}
                </select>
              </label>
              <label>
                개구부 종류
                <select
                  aria-label="개구부 종류"
                  value={openingType}
                  onChange={(e) =>
                    setOpeningType(e.target.value as typeof openingType)
                  }
                >
                  <option value="door">문</option>
                  <option value="window">창문</option>
                </select>
              </label>
            </>
          )}
          <div className="geometry-fields">
            {(selectedRoom ? ["폭", "높이", "깊이"] : ["폭", "높이"]).map(
              (label, index) => (
                <label key={label}>
                  {label} (m)
                  <input
                    aria-label={`${label} (m)`}
                    type="number"
                    step="0.1"
                    value={dimensions[index] ?? ""}
                    onChange={(e) =>
                      setDimensions((values) =>
                        values.map((value, i) =>
                          i === index ? e.target.value : value,
                        ),
                      )
                    }
                  />
                </label>
              ),
            )}
          </div>
          {!selectedOpening && <PoseFields pose={pose} setPose={setPose} />}
          {selectedOpening && (
            <>
              <div className="geometry-fields">
                {["X", "Y"].map((axis, index) => (
                  <label key={axis}>
                    개구부 중심 {axis} (m)
                    <input
                      aria-label={`개구부 중심 ${axis} (m)`}
                      type="number"
                      step="0.1"
                      value={offset[index]}
                      onChange={(e) =>
                        setOffset((values) =>
                          values.map((value, i) =>
                            i === index ? e.target.value : value,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="cms-note">
                표면 중심을 기준으로 한 XY 위치입니다. 크기 전체가 벽 안에 들어
                있어야 합니다. 바닥에 닿는 문의 Y 중심은 (문 높이 − 벽 높이) /
                2입니다.
              </p>
            </>
          )}
          <div className="cms-actions">
            <button
              onClick={() =>
                work(() => {
                  const [width = NaN, height = NaN, depth = NaN] =
                    numbers(dimensions);
                  if (selectedRoom)
                    execute({
                      type: "set-room",
                      id: selectedRoom.id,
                      room: {
                        name,
                        dimensions: { width, height, depth },
                        transform: pose,
                      },
                    });
                  if (selectedSurface)
                    execute({
                      type: "set-surface",
                      id: selectedSurface.id,
                      surface: {
                        roomId: parent,
                        type: surfaceType,
                        dimensions: { width, height },
                        transform: pose,
                      },
                    });
                  if (selectedOpening) {
                    const [x = NaN, y = NaN] = numbers(offset);
                    const opening = {
                      ...selectedOpening,
                      surfaceId: parent,
                      type: openingType,
                      dimensions: { width, height },
                      offset: [x, y] as [number, number],
                    };
                    if (openingType === "window") {
                      delete opening.connectsToOpeningId;
                      delete opening.exterior;
                    } else if (!opening.connectsToOpeningId)
                      opening.exterior = true;
                    const { id: omit, ...value } = opening;
                    void omit;
                    execute({
                      type: "set-opening",
                      id: selectedOpening.id,
                      opening: value,
                    });
                  }
                })
              }
            >
              선택 요소 속성 적용
            </button>
            <button
              onClick={() =>
                execute({
                  type:
                    selection.kind === "room"
                      ? "remove-room"
                      : selection.kind === "surface"
                        ? "remove-surface"
                        : "remove-opening",
                  id: selection.id,
                })
              }
            >
              선택 요소 삭제
            </button>
          </div>
          {selectedRoom && (
            <button
              onClick={() =>
                work(() => {
                  const surface = newSurface(
                    selectedRoom.id,
                    "wall",
                    {
                      width: selectedRoom.dimensions.width,
                      height: selectedRoom.dimensions.height,
                    },
                    {
                      ...identity,
                      position: [
                        0,
                        selectedRoom.dimensions.height / 2,
                        selectedRoom.dimensions.depth / 2,
                      ],
                    },
                  );
                  execute({ type: "add-surface", surface });
                  setSelection({ kind: "surface", id: surface.id });
                })
              }
            >
              선택 방에 벽 추가
            </button>
          )}
          {selectedSurface?.type === "wall" && (
            <button
              onClick={() =>
                work(() => {
                  const door = newDoor(
                    selectedSurface.id,
                    {
                      width: Math.min(1, selectedSurface.dimensions.width),
                      height: Math.min(2.1, selectedSurface.dimensions.height),
                    },
                    [
                      0,
                      (Math.min(2.1, selectedSurface.dimensions.height) -
                        selectedSurface.dimensions.height) /
                        2,
                    ],
                  );
                  execute({ type: "add-opening", opening: door });
                  setSelection({ kind: "opening", id: door.id });
                })
              }
            >
              선택 벽에 외부 문 추가
            </button>
          )}
          {selectedSurface && (
            <fieldset>
              <legend>표면 PBR 재질</legend>
              <label>
                표면 색상
                <input
                  aria-label="표면 색상"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value.toLowerCase())}
                />
              </label>
              <div className="geometry-fields">
                <label>
                  거칠기 (0–1)
                  <input
                    aria-label="거칠기 (0–1)"
                    type="number"
                    step="0.05"
                    value={roughness}
                    onChange={(e) => setRoughness(e.target.value)}
                  />
                </label>
                <label>
                  금속성 (0–1)
                  <input
                    aria-label="금속성 (0–1)"
                    type="number"
                    step="0.05"
                    value={metalness}
                    onChange={(e) => setMetalness(e.target.value)}
                  />
                </label>
              </div>
              <div className="cms-actions">
                <button
                  onClick={() =>
                    work(() => {
                      const [r = NaN, m = NaN] = numbers([
                        roughness,
                        metalness,
                      ]);
                      execute({
                        type: "set-material",
                        surfaceId: selectedSurface.id,
                        material: { color, roughness: r, metalness: m },
                      });
                    })
                  }
                >
                  표면 재질 적용
                </button>
                <button
                  onClick={() =>
                    execute({
                      type: "set-material",
                      surfaceId: selectedSurface.id,
                      material: null,
                    })
                  }
                >
                  표면 재질 기본값
                </button>
              </div>
              <p className="cms-note">
                색상·거칠기·금속성을 로컬 3D 미리보기에 적용합니다. 텍스처·외부
                URL을 불러오지 않습니다. 재질은 version 1의
                org.exhibitos.studio/materials 확장에 저장됩니다.
              </p>
            </fieldset>
          )}
          {selectedOpening?.type === "door" && (
            <fieldset>
              <legend>문 연결</legend>
              <label>
                연결할 다른 방의 문
                <select
                  aria-label="연결할 다른 방의 문"
                  value={secondDoor}
                  onChange={(e) => setSecondDoor(e.target.value)}
                >
                  <option value="">문 선택</option>
                  {document.openings
                    .filter(
                      (item) =>
                        item.type === "door" && item.id !== selectedOpening.id,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="cms-actions">
                <button
                  disabled={!secondDoor}
                  onClick={() =>
                    execute({
                      type: "connect-doors",
                      firstId: selectedOpening.id,
                      secondId: secondDoor,
                    })
                  }
                >
                  두 문 연결
                </button>
                <button
                  onClick={() =>
                    execute({ type: "disconnect-door", id: selectedOpening.id })
                  }
                >
                  문 연결 해제·외부 문으로
                </button>
              </div>
            </fieldset>
          )}
        </fieldset>
      )}
      <PlacementEditor
        document={document}
        execute={execute}
        session={session}
        disabled={disabled}
      />
      <GeometryPreview
        document={document}
        session={session}
        selection={selection}
        appearance={appearance}
      />
    </section>
  );
}
