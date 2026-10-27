// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { FailedView, type FailedViewProps } from './ResultViews';

const root = document.createElement('div');
afterEach(() => render(null, root));

const props = (error: FailedViewProps['error']): FailedViewProps => ({
  error,
  stage: error.stage,
  models: [],
  canRetry: false,
  ambiguous: false,
  onRetry: () => undefined,
  onSendAnyway: () => undefined,
  onDiscard: () => undefined,
  openUrl: () => undefined,
});

describe('FailedView', () => {
  it('shows the pipeline message and keeps the stage', () => {
    const message = 'Manyfold refused the upload of "x.stl" (HTTP 413).';
    render(<FailedView {...props({ code: 'upload-failed', message, stage: 'uploading' })} />, root);
    expect(root.querySelector('.error')?.textContent).toBe(message);
    expect(root.textContent).toContain('Stopped at: Uploading to Manyfold');
  });
  it('renders the message as text, not HTML', () => {
    render(<FailedView {...props({ code: 'unknown', message: '<img src=x>', stage: 'uploading' })} />, root);
    expect(root.querySelector('img')).toBeNull();
  });
  it('falls back to the code text for an empty message or unknown code', () => {
    render(<FailedView {...props({ code: 'retry-unavailable', message: '', stage: 'uploading' })} />, root);
    expect(root.querySelector('.error')?.textContent).toContain('can no longer be retried');
    render(<FailedView {...props({ code: 'nope' as never, message: '', stage: 'uploading' })} />, root);
    expect(root.querySelector('.error')?.textContent).toBe('Something went wrong while sending.');
  });
});
