import { type Component, createSignal, onCleanup, onMount, Show } from "solid-js";

interface Props {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

/**
 * A live camera view with a shutter, for devices whose file input cannot open
 * the camera itself, such as a laptop with a front camera. Phones use the file
 * input's capture hint instead, which opens their own camera app.
 */
const CameraCapture: Component<Props> = (props) => {
  let videoRef!: HTMLVideoElement;
  let stream: MediaStream | null = null;
  let closed = false;
  const [error, setError] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);

  const stopStream = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  onMount(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (closed) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      videoRef.srcObject = s;
      // Set muted as a DOM property; the HTML attribute alone is unreliable in Firefox.
      videoRef.muted = true;
      await videoRef.play();
      setReady(true);
    } catch (e) {
      if (!closed) setError(e instanceof Error ? e.message : String(e));
    }
  });

  onCleanup(() => {
    closed = true;
    stopStream();
  });

  const capture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.videoWidth;
    canvas.height = videoRef.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { setError("Could not read a frame from the camera."); return; }
      stopStream();
      props.onCapture(new File([blob], "camera.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  };

  return (
    <div class="camera-capture">
      <Show
        when={!error()}
        fallback={<div class="field-error" role="alert">Camera unavailable: {error()}</div>}
      >
        <div class="camera-capture-frame">
          <video ref={videoRef} class="camera-capture-video" playsinline aria-label="Camera preview" />
        </div>
        <div class="field-hint">Hold the list up to the camera, then take the photo.</div>
      </Show>
      <div class="actions">
        <button type="button" class="btn-ghost" onClick={props.onCancel}>Cancel</button>
        <Show when={!error()}>
          <button type="button" class="btn-primary" disabled={!ready()} onClick={capture}>Take photo</button>
        </Show>
      </div>
    </div>
  );
};

export default CameraCapture;
