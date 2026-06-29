import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera } from "lucide-react";
import { Button } from "./ui/button";

type Props = {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
};

/** Modal that opens the webcam, shows a mirrored live preview, and grabs a still frame. */
export function WebcamCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      })
      .catch(() => setError("Webcam non disponibile o permesso negato."));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/png"));
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onPointerDown={onClose}>
      <div
        className="flex max-h-[90vh] w-[min(560px,90vw)] flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">📷 Scatta una foto</h3>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <video ref={videoRef} playsInline muted className="max-h-[70vh] w-full rounded-lg bg-black object-contain" style={{ transform: "scaleX(-1)" }} />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Annulla</Button>
          {!error && (
            <Button size="sm" onClick={snap}>
              <Camera /> Scatta
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
