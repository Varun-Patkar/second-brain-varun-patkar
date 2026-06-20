/**
 * useVoiceRecorder — records microphone audio with MediaRecorder and transcribes
 * it through the configured Whisper STT server. Exposes a simple state machine
 * (idle → recording → transcribing) so the composer can render the right control.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState } from "react";
import { transcribeAudio } from "../api.js";

type RecorderState = "idle" | "recording" | "transcribing";

/**
 * @param sttUrl - Base URL of the STT server (empty disables recording).
 * @param onTranscript - Called with the recognized text when transcription completes.
 * @param onError - Called with a human-readable message on failure.
 */
export function useVoiceRecorder(
  sttUrl: string,
  onTranscript: (text: string) => void,
  onError?: (message: string) => void,
) {
  const [state, setState] = useState<RecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (!sttUrl) {
      onError?.("Set a Speech-to-text URL in settings first.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setState("transcribing");
        try {
          const text = await transcribeAudio(sttUrl, blob);
          if (text) onTranscript(text);
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setState("idle");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Microphone unavailable");
      setState("idle");
    }
  }, [sttUrl, onTranscript, onError]);

  return { state, start, stop };
}
