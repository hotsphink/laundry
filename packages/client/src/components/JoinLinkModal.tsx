import { type Component, createSignal, createEffect, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import Modal from "./Modal.js";
import { parseJoinInput, joinRoutePath } from "../sync/joinLink.js";
import { useQrScanner } from "../hooks/useQrScanner.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Take a join link by pasting or scanning it here, then hand it to JoinPage.
 * For a browser with no account yet, such as Safari after joining in Firefox.
 * The scan has to happen in-page: the iOS Camera app would open the link in
 * the default browser instead of this one.
 */
const JoinLinkModal: Component<Props> = (props) => {
  const navigate = useNavigate();
  const [pasted, setPasted] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  let videoRef!: HTMLVideoElement;
  let canvasRef!: HTMLCanvasElement;

  const scanner = useQrScanner({
    videoRef: () => videoRef,
    canvasRef: () => canvasRef,
    onDecode: (text) => { if (parseJoinInput(text)) use(text); },
  });

  createEffect(() => {
    if (props.open) {
      setPasted("");
      setError(null);
      scanner.start();
    } else {
      scanner.stop();
    }
  });

  function use(text: string) {
    const link = parseJoinInput(text);
    if (!link) { setError("That isn't a Listr join link."); return; }
    scanner.stop();
    props.onClose();
    navigate(joinRoutePath(link), { state: { fromApp: true } });
  }

  const submit = (e: Event) => {
    e.preventDefault();
    if (pasted().trim()) use(pasted().trim());
  };

  return (
    <Modal open={props.open} onClose={props.onClose} class="scan-share">
      <h2>Join with a link</h2>
      <Show
        when={!scanner.cameraError()}
        fallback={<div class="scan-no-camera field-hint">Camera unavailable: {scanner.cameraError()}</div>}
      >
        <div class="scan-preview-wrapper">
          <video ref={videoRef!} class="scan-preview" playsinline aria-label="Camera preview for scanning a join code" />
          <canvas ref={canvasRef!} hidden />
        </div>
      </Show>
      <form onSubmit={submit} class="scan-manual-form">
        <label class="scan-manual-label" for="join-link-input">Or paste the link you were sent:</label>
        <div class="control-row">
          <input
            id="join-link-input"
            value={pasted()}
            onInput={(e) => setPasted(e.currentTarget.value)}
            placeholder="https://..."
            autocomplete="off"
            spellcheck={false}
          />
          <button class="btn-primary" type="submit">Use</button>
        </div>
        <Show when={error()}><div class="field-error" role="alert">{error()}</div></Show>
      </form>
      <div class="actions">
        <button class="btn-ghost" type="button" onClick={props.onClose}>Cancel</button>
      </div>
    </Modal>
  );
};

export default JoinLinkModal;
