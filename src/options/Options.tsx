import './options.css';
import { useEffect, useState } from 'preact/hooks';
import { CONNECTED_WORD, runConnectionCheck, type ConnectionLevel } from '../connection-test';
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

/** The project's GitHub repository (confirmed by the owner). */
export const GITHUB_URL = 'https://github.com/jackalopes/send-to-manyfold';

function manifestVersion(): string | undefined {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return undefined;
  }
}

function Switch({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label class="row">
      <span>
        <span class="label">{label}</span>
        {sub ? <span class="sub">{sub}</span> : null}
      </span>
      <input type="checkbox" role="switch" class="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

export function Options() {
  const [s, setS] = useState<Settings>(defaultSettings());
  const [test, setTest] = useState<{ level: ConnectionLevel; text: string; connected?: boolean }>({ level: 'ok', text: '' });
  const [save, setSave] = useState<{ level: ConnectionLevel; text: string }>({ level: 'ok', text: '' });
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
      setSave({ level: 'error', text: result.message });
      return;
    }
    const saved = await loadSettings();
    setS(saved);
    setSavedUrl(saved.manyfoldUrl);
    setSave({ level: 'ok', text: 'Saved.' });
    setCollections(await loadCollectionOptions(saved));
  }

  async function onTest() {
    setTest({ level: 'ok', text: 'Testing connection...' });
    const check = await runConnectionCheck(s.manyfoldUrl, s.token);
    setTest({ level: check.level, text: check.message, connected: check.connected });
    if (check.level !== 'error') setCollections(await loadCollectionOptions(s));
  }

  const version = manifestVersion();
  return (
    <>
      <header>
        <div class="head">
          <img src="/icon/128.png" alt="" />
          <div>
            <h1>Send To Manyfold</h1>
            <p>Send 3D models from model sites to your own Manyfold library.</p>
          </div>
        </div>
      </header>
      <form onSubmit={onSave}>
        <h2>Connection</h2>
        <div class="card connection">
          <div class="row stack">
            <label>
              <span class="label">Manyfold URL</span>
              <input type="text" value={s.manyfoldUrl} placeholder="http://192.168.1.5:3214"
                onInput={(e) => setS({ ...s, manyfoldUrl: e.currentTarget.value })} />
            </label>
            <p class="sub">
              Without http:// or https:// the address defaults to https://, except IP addresses, localhost and .local/.lan/.home.arpa/.internal names. For a LAN name over http, type http://nas:3214.
            </p>
            {isInsecurePublicUrl(savedUrl) ? (
              <p role="alert" class="msg error">
                Warning: the saved URL uses http: on a public host, so your API token travels unencrypted. Use an https: address.
              </p>
            ) : null}
          </div>
          <div class="row stack">
            <label>
              <span class="label">API token</span>
              <input type="password" value={s.token} autoComplete="off"
                onInput={(e) => setS({ ...s, token: e.currentTarget.value })} />
            </label>
          </div>
          <div class="row">
            <p class={`msg test-result ${test.level}`} role={test.level === 'error' ? 'alert' : 'status'}>
              {test.level === 'warning' ? 'Warning: ' : ''}
              {test.connected ? <><strong class="ok">{CONNECTED_WORD}</strong>{test.text.slice(CONNECTED_WORD.length)}</> : test.text}
            </p>
            <button type="button" class="btn ghost" onClick={() => void onTest()}>Test connection</button>
          </div>
          <div class="row stack">
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
          </div>
        </div>

        <h2>When sending</h2>
        <div class="card">
          <div class="row">
            <div>
              <span class="label">Default collection</span>
              <span class="sub">Preselected in the popup; you can change it per send.</span>
            </div>
            <div class="picker">
              <CollectionPicker value={s.defaultCollectionId ?? ''} options={collections}
                onChange={(id) => setS({ ...s, defaultCollectionId: lastSegment(id) })} />
            </div>
          </div>
          <Switch label="Include preview images" sub="Upload the model's pictures along with its files." checked={s.includeImages}
            onChange={(v) => setS((p) => ({ ...p, includeImages: v }))} />
          <Switch label="Mark uploads as sensitive" sub="Default for new models." checked={s.defaultSensitive}
            onChange={(v) => setS((p) => ({ ...p, defaultSensitive: v }))} />
        </div>

        <h2>Prefill from the model page</h2>
        <div class="card">
          <div class="grid">
            {PREFILL_FIELDS.map((f) => (
              <Switch key={f} label={LABELS[f]} checked={s.prefill[f]}
                onChange={(v) => setS((p) => ({ ...p, prefill: { ...p.prefill, [f]: v } }))} />
            ))}
          </div>
        </div>

        <div class="actions">
          <p class={`msg save-result ${save.level}`} role={save.level === 'error' ? 'alert' : 'status'}>{save.text}</p>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
      <footer>
        {version ? `Version ${version} · ` : ''}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        {' · Unofficial, not affiliated with Manyfold.'}
      </footer>
    </>
  );
}
