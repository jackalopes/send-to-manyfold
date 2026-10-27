import { useEffect, useState } from 'preact/hooks';
import { runConnectionCheck, type ConnectionLevel } from '../connection-test';
import type { NamedRef } from '../manyfold/metadata';
import { CollectionPicker, lastSegment } from '../ui/CollectionPicker';
import { loadCollectionOptions } from './collections';
import {
  PREFILL_FIELDS, defaultSettings, isInsecurePublicUrl, loadSettings, saveWithPermission, type PrefillField, type Settings,
} from '../settings';

const LABELS: Record<PrefillField, string> = {
  title: 'Title', description: 'Description', creator: 'Creator', license: 'License',
  tags: 'Tags', sourceUrl: 'Source URL', images: 'Images',
};

export function Options() {
  const [s, setS] = useState<Settings>(defaultSettings());
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState<ConnectionLevel>('ok');
  const [savedUrl, setSavedUrl] = useState('');
  const [collections, setCollections] = useState<NamedRef[] | undefined>();

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setS(loaded);
      setSavedUrl(loaded.manyfoldUrl);
      void loadCollectionOptions(loaded).then(setCollections);
    });
  }, []);

  async function onSave(e: Event) {
    e.preventDefault();
    const result = await saveWithPermission(s);
    if (!result.ok) {
      setLevel('error');
      setStatus(result.message);
      return;
    }
    const saved = await loadSettings();
    setS(saved);
    setSavedUrl(saved.manyfoldUrl);
    setLevel('ok');
    setStatus('Saved.');
    setCollections(await loadCollectionOptions(saved));
  }

  async function onTest() {
    setStatus('Testing connection...');
    setLevel('ok');
    const check = await runConnectionCheck(s.manyfoldUrl, s.token);
    setLevel(check.level);
    setStatus(check.message);
    if (check.level !== 'error') setCollections(await loadCollectionOptions(s));
  }

  return (
    <form onSubmit={onSave} style={{ maxWidth: '40rem', margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Send To Manyfold</h1>
      <label>
        Manyfold URL
        <input type="text" value={s.manyfoldUrl} placeholder="http://192.168.1.5:3214" style={{ display: 'block', width: '100%' }}
          onInput={(e) => setS({ ...s, manyfoldUrl: e.currentTarget.value })} />
      </label>
      {isInsecurePublicUrl(savedUrl) ? (
        <p role="alert" style={{ color: '#b00020' }}>
          Warning: the saved URL uses http: on a public host, so your API token travels unencrypted. Use an https: address.
        </p>
      ) : null}
      <label>
        API token
        <input type="password" value={s.token} autoComplete="off" style={{ display: 'block', width: '100%' }}
          onInput={(e) => setS({ ...s, token: e.currentTarget.value })} />
      </label>
      <details open={!s.token}>
        <summary>How to create a token</summary>
        <p>Manyfold makes you create an <strong>API key</strong> first, then an <strong>access token</strong> inside it. Only the token goes here.</p>
        <ol>
          <li>
            Sign in to Manyfold as a user who can upload (contributor role or higher). Open your account menu (top right) and choose <strong>API keys</strong>, under Developers
            {savedUrl ? <>, or open <a href={`${savedUrl}/oauth/applications/new`} target="_blank" rel="noreferrer">New API key</a> directly</> : null}.
          </li>
          <li>
            Click <strong>New API key</strong> and fill in:
            <ul>
              <li><strong>Name</strong>: anything, for example <code>Send To Manyfold</code>.</li>
              <li><strong>Redirect URI</strong>: <code>urn:ietf:wg:oauth:2.0:oob</code></li>
              <li><strong>Scopes</strong>: select <code>read</code>, <code>write</code> and <code>upload</code> (hold Ctrl, or Cmd on a Mac, to pick several).</li>
            </ul>
            Leave Confidential as it is and click <strong>Save API key details</strong>.
          </li>
          <li>On the API key's page, scroll to <strong>Access Tokens</strong> and click <strong>New Access Token</strong>. Pick an <strong>Expiration</strong> (6 months at most), select the same three scopes, and click <strong>Submit</strong>.</li>
          <li>Reveal the token and copy it. Manyfold shows it only once. Paste it above, click <strong>Save</strong>, then <strong>Test connection</strong>.</li>
        </ol>
        <p>When the token expires, repeat steps 3 and 4 with the same API key.</p>
      </details>
      <fieldset>
        <legend>Prefill fields</legend>
        {PREFILL_FIELDS.map((f) => (
          <label key={f} style={{ display: 'block' }}>
            <input type="checkbox" checked={s.prefill[f]}
              onChange={(e) => setS({ ...s, prefill: { ...s.prefill, [f]: e.currentTarget.checked } })} />
            {' '}{LABELS[f]}
          </label>
        ))}
      </fieldset>
      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={s.includeImages}
          onChange={(e) => setS({ ...s, includeImages: e.currentTarget.checked })} />
        {' '}Include preview images
      </label>
      <CollectionPicker value={s.defaultCollectionId ?? ''} options={collections}
        onChange={(id) => setS({ ...s, defaultCollectionId: lastSegment(id) })} />
      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={s.defaultSensitive}
          onChange={(e) => setS({ ...s, defaultSensitive: e.currentTarget.checked })} />
        {' '}Mark uploads as sensitive by default
      </label>
      <button type="submit">Save</button>
      {' '}
      <button type="button" onClick={() => void onTest()}>Test connection</button>
      <p role={level === 'error' ? 'alert' : 'status'} style={{ color: level === 'error' ? '#b00020' : level === 'warning' ? '#8a5a00' : undefined }}>
        {level === 'warning' ? 'Warning: ' : ''}{status}
      </p>
    </form>
  );
}
