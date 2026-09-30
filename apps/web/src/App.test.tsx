import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders a semantic Korean entry page with a connection action and honest feature status', () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('aria-labelledby="title"');
  expect(html).toContain('role="status"');
  expect(html).toContain('연결 확인');
  expect(html).toContain('후속 단계에서 구현합니다');
});
