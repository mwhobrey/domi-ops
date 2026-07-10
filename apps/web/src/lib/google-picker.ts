export const GOOGLE_FORMS_MIME = "application/vnd.google-apps.form";

export interface GooglePickerFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export function isGoogleFormsMime(mimeType: string): boolean {
  return mimeType === GOOGLE_FORMS_MIME;
}

export function googleFileOpenUrl(fileId: string, mimeType?: string | null): string {
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return `https://docs.google.com/presentation/d/${fileId}/edit`;
  }
  if (mimeType === "application/vnd.google-apps.document") {
    return `https://docs.google.com/document/d/${fileId}/edit`;
  }
  return `https://drive.google.com/file/d/${fileId}/view`;
}

type GapiLoadCallback = () => void;

interface GapiStatic {
  load: (api: string, opts: { callback: GapiLoadCallback }) => void;
}

interface GooglePickerBuilder {
  setTitle: (title: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  addView: (view: unknown) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerResponse) => void) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

interface GooglePickerResponse {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType: string; url?: string }>;
}

interface GooglePickerNamespace {
  PickerBuilder: new () => GooglePickerBuilder;
  Action: { PICKED: string; CANCEL: string };
  ViewId: { DOCS: string; DOCS_IMAGES_AND_VIDEOS: string };
  DocsView: new () => { setIncludeFolders: (v: boolean) => unknown };
  DocsUploadView: new () => unknown;
}

declare global {
  interface Window {
    gapi?: GapiStatic;
    google?: { picker: GooglePickerNamespace };
  }
}

let gapiScriptPromise: Promise<void> | null = null;

function loadGapiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("picker_unavailable"));
  if (window.gapi?.load) return Promise.resolve();
  if (gapiScriptPromise) return gapiScriptPromise;

  gapiScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-domi-google-api="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gapi_load_failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.domiGoogleApi = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gapi_load_failed"));
    document.head.appendChild(script);
  });
  return gapiScriptPromise;
}

function loadPickerApi(): Promise<void> {
  return loadGapiScript().then(
    () =>
      new Promise((resolve, reject) => {
        if (!window.gapi?.load) {
          reject(new Error("gapi_unavailable"));
          return;
        }
        window.gapi.load("picker", {
          callback: () => resolve(),
        });
      }),
  );
}

export async function openGooglePicker(opts: {
  accessToken: string;
  developerKey: string;
  appId: string;
  title?: string;
  onPicked: (file: GooglePickerFile) => void;
  onCancel?: () => void;
  onFormsRejected?: () => void;
}): Promise<void> {
  await loadPickerApi();
  const picker = window.google?.picker;
  if (!picker) throw new Error("picker_unavailable");

  const docsView = new picker.DocsView();
  docsView.setIncludeFolders(true);
  const uploadView = new picker.DocsUploadView();

  const builder = new picker.PickerBuilder()
    .setTitle(opts.title ?? "Select a file")
    .setOAuthToken(opts.accessToken)
    .setDeveloperKey(opts.developerKey)
    .setAppId(opts.appId)
    .addView(docsView)
    .addView(picker.ViewId.DOCS_IMAGES_AND_VIDEOS)
    .addView(uploadView)
    .setCallback((data) => {
      if (data.action === picker.Action.CANCEL) {
        opts.onCancel?.();
        return;
      }
      if (data.action !== picker.Action.PICKED || !data.docs?.[0]) return;
      const doc = data.docs[0];
      if (isGoogleFormsMime(doc.mimeType)) {
        opts.onFormsRejected?.();
        return;
      }
      opts.onPicked({
        id: doc.id,
        name: doc.name,
        mimeType: doc.mimeType,
        url: doc.url ?? googleFileOpenUrl(doc.id, doc.mimeType),
      });
    });

  builder.build().setVisible(true);
}
