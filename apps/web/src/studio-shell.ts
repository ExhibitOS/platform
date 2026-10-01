export async function prepareStudioShell(
  status: (message: string) => void,
  waiting: (registration: ServiceWorkerRegistration | null) => void,
): Promise<() => void> {
  if (!import.meta.env.PROD) {
    status(
      "개발 서버: IndexedDB 저장은 가능하지만 오프라인 앱 재시작은 production build에서 지원합니다.",
    );
    return () => {};
  }
  if (!("serviceWorker" in navigator)) {
    status(
      "이 브라우저에서 오프라인 앱 준비를 사용할 수 없습니다. JSON 파일로 백업하세요.",
    );
    return () => {};
  }
  status("오프라인 앱 준비 중… 처음 준비할 때는 연결이 필요합니다.");
  const registration = await navigator.serviceWorker.register("/studio-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  let live = true;
  const update = () => {
    if (!live) return;
    waiting(registration.waiting ? registration : null);
    if (registration.active && navigator.serviceWorker.controller)
      status(
        "오프라인 앱 준비 완료. 이 브라우저에서 /studio를 다시 열 수 있습니다.",
      );
  };
  const installed = () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (!live) return;
      if (worker.state === "redundant")
        status(
          "오프라인 앱 준비가 완료되지 않았습니다. 저장 공간·연결을 확인하고 JSON 파일을 백업하세요.",
        );
      update();
    });
  };
  registration.addEventListener("updatefound", installed);
  navigator.serviceWorker.addEventListener("controllerchange", update);
  installed();
  update();
  void navigator.serviceWorker.ready.then(update);
  return () => {
    live = false;
    registration.removeEventListener("updatefound", installed);
    navigator.serviceWorker.removeEventListener("controllerchange", update);
  };
}
