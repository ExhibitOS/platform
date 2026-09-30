import { useState } from 'react';

export function App() {
  const [status, setStatus] = useState('연결을 확인해 주세요.');
  const [checking, setChecking] = useState(false);
  async function checkConnection() {
    setChecking(true);
    setStatus('연결 확인 중…');
    try {
      const response = await fetch('/api/v1/health', { signal: AbortSignal.timeout(5000) });
      const health: unknown = await response.json();
      if (!response.ok || typeof health !== 'object' || health === null ||
        !('status' in health) || health.status !== 'ok' ||
        !('service' in health) || health.service !== 'exhibitos-api') throw new Error('Invalid health response');
      setStatus('API가 연결되었습니다.');
    } catch {
      setStatus('API에 연결할 수 없습니다. 서버를 실행하고 다시 시도해 주세요.');
    } finally { setChecking(false); }
  }
  return <main>
    <header><a className="brand" href="/" aria-label="ExhibitOS 홈">ExhibitOS<span>OPEN EXHIBITION</span></a><span className="phase">개발 기반 · 0.1</span></header>
    <section className="intro" aria-labelledby="title">
      <p className="eyebrow">작품과 공간, 그리고 관람의 연결</p>
      <h1 id="title">전시를 위한<br />열린 기반.</h1>
      <p className="description">작품을 기록하고, 공간을 만들고, 전시를 나누는 ExhibitOS.<br />지금은 웹과 API의 개발 기반을 확인하는 단계입니다.</p>
    </section>
    <section className="connection" aria-labelledby="connection-title">
      <div><p className="eyebrow">LOCAL DEVELOPMENT</p><h2 id="connection-title">서비스 연결</h2><p role="status" aria-live="polite">{status}</p></div>
      <button onClick={() => void checkConnection()} disabled={checking}>{checking ? '확인 중…' : '연결 확인'}</button>
    </section>
    <footer>Studio · Viewer · CMS는 후속 단계에서 구현합니다. 실제 작품이나 계정 정보는 사용하지 않습니다.</footer>
  </main>;
}
