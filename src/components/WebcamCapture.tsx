import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { QuackButton } from "./ui/quack-button";
import {
  StickerDialog,
  StickerDialogContent,
  StickerDialogFooter,
  StickerDialogHeader,
  StickerDialogTitle,
} from "./ui/sticker-dialog";

type Props = {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
};

/** Modal that opens the webcam, shows a mirrored live preview, and grabs a still frame.
 *  Radix underneath via StickerDialog, so the focus trap, the scroll lock and Escape
 *  come with it — the hand-rolled portal this replaced had none of the three. */
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
      .catch(() => setError("Webcam unavailable or permission denied."));

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

  return (
    <StickerDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <StickerDialogContent size="lg" className="max-h-[90vh] max-w-[min(560px,90vw)]">
        <StickerDialogHeader>
          <StickerDialogTitle>Take a photo</StickerDialogTitle>
        </StickerDialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          // The preview is mirrored, the way any selfie view is — the captured
          // frame is not, because the canvas draws the raw video.
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-[70vh] w-full rounded-xl bg-black object-contain"
            style={{ transform: "scaleX(-1)" }}
          />
        )}
        <StickerDialogFooter>
          <QuackButton variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </QuackButton>
          {!error && (
            <QuackButton size="sm" onClick={snap}>
              <Camera /> Capture
            </QuackButton>
          )}
        </StickerDialogFooter>
      </StickerDialogContent>
    </StickerDialog>
  );
}
