import * as vscode from 'vscode';
import { AmdViewProvider } from './amdView';
import { ModelBuilderViewProvider } from './modelBuilderView';

/**
 * Wrapper view that hosts Model Builder and AMD Script Generator as
 * tab-switchable siblings inside one webview.
 *
 * Both sub-panels' HTML lives in the same DOM, but each sub-panel's script
 * runs inside an IIFE that shadows `document`, `window`, and
 * `acquireVsCodeApi` with panel-scoped proxies:
 *
 *   - `document.getElementById` / `querySelector(All)` and
 *     `document.body` / `document.addEventListener` resolve inside the
 *     panel's root subtree, so ID collisions and global click/keydown
 *     delegation don't leak between panels.
 *   - `window.addEventListener('message', …)` registers with a per-panel
 *     dispatch table so extension replies only reach the panel that asked.
 *   - `acquireVsCodeApi()` returns a shim that tags outgoing messages with
 *     `__panel: 'mb'|'amd'`; the wrapper's `onDidReceiveMessage` routes to
 *     the corresponding sub-provider, and replies are tagged back so they
 *     reach the right panel-scoped listener.
 *
 * We use IIFE-scoped shadowing instead of iframes because VS Code webview
 * CSP blocks srcdoc-based frames.
 */
export class ModelDevViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'modelDevelopmentView';

    private amd: AmdViewProvider;
    private mb: ModelBuilderViewProvider;

    constructor(context: vscode.ExtensionContext) {
        this.amd = new AmdViewProvider(context);
        this.mb = new ModelBuilderViewProvider(context);
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = { enableScripts: true };
        view.webview.html = this.getHtml();

        const replyTo = (panel: 'mb' | 'amd') => (m: Record<string, unknown>) => {
            view.webview.postMessage({ ...m, __panel: panel });
        };

        view.webview.onDidReceiveMessage(async (msg: { __panel?: string; command?: string; [k: string]: unknown }) => {
            if (msg.__panel === 'mb') {
                await this.mb.handleMessage(msg, view, replyTo('mb'));
                return;
            }
            if (msg.__panel === 'amd') {
                await this.amd.handleMessage(msg, view, replyTo('amd'));
                return;
            }
            if (msg.command === 'browseSharedInput') {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: 'Select dataset / model file',
                    filters: {
                        'Datasets & models': ['csv', 'tsv', 'txt', 'mod', 'ctl', 'lst'],
                        'All files': ['*']
                    }
                });
                if (picked && picked[0]) {
                    view.webview.postMessage({ command: 'sharedInputPicked', path: picked[0].fsPath });
                }
                return;
            }
        });
    }

    private getHtml(): string {
        const mbParts = extractParts(this.mb.getHtml());
        const amdParts = extractParts(this.amd.getHtml());

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    /* estview-inspired muted palette — inherited by the sub-panels' scoped
       styles so tabs, shared browse button, MFL cards, section headers, etc.
       all share one sober look. */
    --nmb-blue:   #6699cc;
    --nmb-green:  #3bb273;
    --nmb-yellow: #f2c94c;
    --nmb-purple: #b191d6;
    --nmb-red:    #e24c4b;
  }
  /* Wrapper that keeps both the shared file input and the tab bar pinned to
     the top when the panel scrolls. Both used to have their own
     position: sticky; top: 0 — they stacked at the same coordinate and the
     shared row (higher z-index) hid the tab bar. Sticky-ing the parent
     instead makes them travel together. */
  .dev-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, transparent));
    flex: 0 0 auto;
  }
  .dev-shared {
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    flex: 0 0 auto;
  }
  .dev-shared-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--nmb-blue);
    margin-bottom: 4px;
  }
  .dev-shared-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .dev-shared-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, rgba(128,128,128,0.35)));
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }
  .dev-shared-row input:focus {
    border-color: var(--vscode-focusBorder);
  }
  .dev-shared-row button {
    flex: 0 0 auto;
    padding: 3px 10px;
    background: transparent;
    color: var(--nmb-purple);
    border: 1px solid var(--nmb-purple);
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  .dev-shared-row button:hover {
    background: rgba(160, 120, 220, 0.12);
  }
  .dev-tabs {
    display: flex; gap: 4px;
    padding: 6px 6px 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    flex: 0 0 auto;
  }
  .dev-tab {
    flex: 1;
    padding: 5px 10px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 3px 3px 0 0;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    outline: none;
  }
  .dev-tab:hover { background: var(--vscode-list-hoverBackground); }
  .dev-tab.active {
    background: var(--vscode-editor-background, var(--vscode-sideBar-background));
    color: var(--nmb-purple);
    border-color: var(--vscode-panel-border, rgba(128,128,128,0.35));
    border-bottom-color: transparent;
    margin-bottom: -1px;
    font-weight: 600;
  }
  .dev-panel { display: none; }
  .dev-panel.active { display: block; }
  /* --- Model Builder styles --- */
  ${mbParts.style}
  /* --- AMD Script Generator styles --- */
  ${amdParts.style}
  /* --- Overrides: the shared dataset/model input at the top drives both
     sub-panels, so their in-panel file pickers are redundant. Hide them
     while leaving the panel's block-visibility JS untouched (it still
     toggles admin/datatype in MB based on the auto-switched base kind). */
  /* Keep the first <h3> ("Basic information") visible — it now titles the
     Administration / Data type / Model name section that remains after we
     hide the base-file inputs (they're driven by the shared picker above). */
  #tab-mb .base-tabs,                                /* From dataset / From model radios */
  #tab-mb #fromDataset-block > label:first-of-type,  /* "Dataset" label */
  #tab-mb #fromDataset-block > .row:has(#dataset),   /* dataset input + Browse */
  #tab-mb #fromModel-block                           /* modelFile is only content, hide entirely */
    { display: none !important; }
  #tab-amd h3:has(+ .row #input),                    /* "Input" header */
  #tab-amd .row:has(> #input)                        /* AMD input + Browse */
    { display: none !important; }
</style>
</head>
<body>
<div class="dev-header">
  <div class="dev-shared">
    <label class="dev-shared-label" for="sharedInput">Dataset / Model file</label>
    <div class="dev-shared-row">
      <input type="text" id="sharedInput" placeholder="Path to CSV / TSV / .mod / .ctl" spellcheck="false" autocomplete="off" />
      <button id="sharedBrowse" title="Browse for file">Browse…</button>
    </div>
  </div>
  <div class="dev-tabs">
    <button class="dev-tab active" data-devtab="mb">Model Builder</button>
    <button class="dev-tab" data-devtab="amd">AMD</button>
  </div>
</div>
<div id="tab-mb" class="dev-panel active">${mbParts.body}</div>
<div id="tab-amd" class="dev-panel">${amdParts.body}</div>
<script>
  const __realVscode = acquireVsCodeApi();
  const __panelState = { mb: undefined, amd: undefined };
  const __panelMessageListeners = { mb: [], amd: [] };

  // Extension replies arrive with __panel tag — dispatch to the matching panel's listeners.
  // Untagged messages (like sharedInputPicked) are handled inline below.
  window.addEventListener('message', (event) => {
    const d = event && event.data;
    if (!d || typeof d !== 'object') { return; }
    if (d.command === 'sharedInputPicked' && !d.__panel) {
      const p = d.path || '';
      const sharedInput = document.getElementById('sharedInput');
      if (sharedInput) { sharedInput.value = p; }
      applySharedInput(p);
      return;
    }
    if (!d.__panel) { return; }
    const panel = d.__panel;
    const listeners = __panelMessageListeners[panel] || [];
    listeners.forEach(fn => {
      try { fn({ data: d }); } catch (e) { console.error('[modelDev]', panel, 'listener threw', e); }
    });
  });

  // --- Shared dataset / model file input ---
  // One picker above the tabs feeds both sub-panels so the user doesn't have
  // to re-type the same path in Model Builder AND AMD.
  //   * AMD: always fills #input (its run_amd input, which already accepts
  //     both datasets and start-models).
  //   * MB: routes by extension —
  //       .mod / .ctl / .lst  -> switch to "From model", fill #modelFile
  //       everything else     -> switch to "From dataset", fill #dataset
  // We poke the sub-panel DOM directly (input value + dispatched 'change')
  // rather than send a message so the panel's own listeners run their
  // side-effects (preset -> Custom, block visibility toggle, etc.) as if the
  // user had typed in there.
  const sharedInput = document.getElementById('sharedInput');
  const sharedBrowse = document.getElementById('sharedBrowse');

  function isModelFile(p) {
    return /\\.(mod|ctl|lst)$/i.test(String(p || ''));
  }

  function fireInput(el) {
    if (!el) { return; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applySharedInput(p) {
    const path = String(p || '').trim();
    if (!path) { return; }

    const amdRoot = document.getElementById('tab-amd');
    if (amdRoot) {
      const amdField = amdRoot.querySelector('#input');
      if (amdField && amdField.value !== path) {
        amdField.value = path;
        fireInput(amdField);
      }
    }

    const mbRoot = document.getElementById('tab-mb');
    if (mbRoot) {
      const wantModel = isModelFile(path);
      const radios = mbRoot.querySelectorAll('input[name="baseKind"]');
      const wanted = wantModel ? 'fromModel' : 'fromDataset';
      let switched = false;
      radios.forEach(r => {
        if (r.value === wanted && !r.checked) {
          r.checked = true;
          switched = true;
        }
      });
      if (switched && radios.length) {
        radios[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      const target = wantModel ? mbRoot.querySelector('#modelFile') : mbRoot.querySelector('#dataset');
      if (target && target.value !== path) {
        target.value = path;
        fireInput(target);
      }
    }
  }

  if (sharedInput) {
    sharedInput.addEventListener('change', () => applySharedInput(sharedInput.value));
    sharedInput.addEventListener('blur', () => applySharedInput(sharedInput.value));
  }
  if (sharedBrowse) {
    sharedBrowse.addEventListener('click', () => {
      __realVscode.postMessage({ command: 'browseSharedInput' });
    });
  }

  // Tab switcher — operates on real document, not scoped.
  document.querySelectorAll('.dev-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.devtab;
      document.querySelectorAll('.dev-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.dev-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t));
    });
  });

  function makeScoped(panelId) {
    const root = document.getElementById('tab-' + panelId);
    const realDoc = window.document;
    const realWin = window;

    const scopedDoc = new Proxy(realDoc, {
      get(target, prop) {
        if (prop === 'getElementById') {
          return (id) => root.querySelector('#' + (window.CSS && window.CSS.escape ? window.CSS.escape(id) : id));
        }
        if (prop === 'querySelector') { return (sel) => root.querySelector(sel); }
        if (prop === 'querySelectorAll') { return (sel) => root.querySelectorAll(sel); }
        if (prop === 'body') { return root; }
        if (prop === 'addEventListener') { return (t, fn, o) => root.addEventListener(t, fn, o); }
        if (prop === 'removeEventListener') { return (t, fn, o) => root.removeEventListener(t, fn, o); }
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });

    const scopedWin = new Proxy(realWin, {
      get(target, prop) {
        if (prop === 'addEventListener') {
          return (type, fn, opts) => {
            if (type === 'message') {
              __panelMessageListeners[panelId].push(fn);
            } else {
              target.addEventListener(type, fn, opts);
            }
          };
        }
        if (prop === 'document') { return scopedDoc; }
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });

    const scopedApi = () => ({
      postMessage: (msg) => __realVscode.postMessage(Object.assign({}, msg, { __panel: panelId })),
      setState: (s) => { __panelState[panelId] = s; },
      getState: () => __panelState[panelId],
    });

    return { document: scopedDoc, window: scopedWin, acquireVsCodeApi: scopedApi };
  }

  // Model Builder panel
  (function () {
    const { document, window, acquireVsCodeApi } = makeScoped('mb');
    ${mbParts.script}
  })();

  // AMD Script Generator panel
  (function () {
    const { document, window, acquireVsCodeApi } = makeScoped('amd');
    ${amdParts.script}
  })();
</script>
</body>
</html>`;
    }
}

/**
 * Pull the <style> block, <body> inner HTML (minus the trailing <script>),
 * and the <script> body out of a fully-formed sub-provider HTML document.
 * Falls back to empty strings if a section can't be located so the wrapper
 * still renders instead of throwing during registration.
 */
function extractParts(html: string): { style: string; body: string; script: string } {
    const rawStyle = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? '';
    const bodyInner = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';
    const script = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(bodyInner)?.[1] ?? '';
    const body = bodyInner.replace(/<script[^>]*>[\s\S]*?<\/script>/i, '').trim();
    // Rewrite sub-provider CSS selectors that would fight the wrapper:
    //   `body { padding … }`  -> `.dev-panel { padding … }`  (padding lands
    //     inside the panel, not around the outer tabbed frame)
    //   `html { … }`  -> `.dev-panel { … }` (same reason)
    // A simple boundary-anchored regex is enough — the sub-providers author
    // their CSS in a consistent style with the selector at the start of a
    // line, so we don't need a full CSS parser.
    const style = rawStyle
        .replace(/(^|[\s,;}])body(\s*[{,])/g, '$1.dev-panel$2')
        .replace(/(^|[\s,;}])html(\s*[{,])/g, '$1.dev-panel$2');
    return { style, body, script };
}
