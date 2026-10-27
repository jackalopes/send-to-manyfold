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
      <details>
        <summary>How to create a token</summary>
        <ol>
          <li>In Manyfold, open <code>/oauth/applications</code> (the "API keys" page; its menu location is unverified). Sign in as a user with upload permission (contributor role or higher).</li>
          <li>Choose "New API key", give it the <code>read</code>, <code>write</code> and <code>upload</code> scopes, and save.</li>
          <li>On its page choose "New Access Token", select the same scopes and an expiry, then copy the token (shown once) and paste it above.</li>
          <li><em>These steps come from Manyfold's source and have not been tried on a live instance.</em></li>
        </ol>
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
