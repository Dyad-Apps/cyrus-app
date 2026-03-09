import { useEffect, useRef, useState } from 'react';
import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
  SpeechRecognizedEvent,
} from '@react-native-voice/voice';

const WAKE_WORD = 'cyrus';

export interface VoiceStatus {
  listening: boolean;
  partial: string;
  error: string;
}

interface Options {
  enabled: boolean;
  paused: boolean;
  onUtterance: (text: string) => void;
}

export function useVoiceInput({ enabled, paused, onUtterance }: Options): VoiceStatus {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const activeRef = useRef(false);
  const enabledRef = useRef(enabled);
  const pausedRef = useRef(paused);
  const onUtteranceRef = useRef(onUtterance);
  const restartTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryCount = useRef(0);

  // Keep refs in sync without triggering effects
  enabledRef.current = enabled;
  pausedRef.current = paused;
  onUtteranceRef.current = onUtterance;

  const stopListening = () => {
    clearTimeout(restartTimer.current);
    activeRef.current = false;
    setListening(false);
    setPartial('');
    Voice.stop().catch(() => {});
  };

  const startListening = () => {
    if (activeRef.current || !enabledRef.current || pausedRef.current) return;
    if (retryCount.current > 5) {
      retryCount.current = 0;
      setError('Speech recognition unavailable — restarting');
      // Try again after a longer pause instead of giving up forever
      restartTimer.current = setTimeout(() => {
        setError('');
        startListening();
      }, 10000);
      return;
    }
    activeRef.current = true;
    setListening(true);
    setPartial('');
    setError('');
    Voice.start('en-US').catch((err) => {
      activeRef.current = false;
      setListening(false);
      setError(`Mic start failed: ${err?.message || err}`);
    });
  };

  // Set up Voice callbacks once
  useEffect(() => {
    Voice.onSpeechStart = () => {
      setListening(true);
    };

    Voice.onSpeechRecognized = (_e: SpeechRecognizedEvent) => {
      // Speech was recognized (intermediate event)
    };

    Voice.onSpeechPartialResults = (e: { value?: string[] }) => {
      const text = (e.value?.[0] ?? '').trim();
      if (text) setPartial(text);
    };

    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = (e.value?.[0] ?? '').trim();
      retryCount.current = 0;
      setPartial('');
      if (text) {
        // Check for wake word, or if the text is a direct command
        if (text.toLowerCase().startsWith(WAKE_WORD)) {
          onUtteranceRef.current(text);
        } else {
          // Show what was heard even if wake word wasn't detected
          setPartial(`(no wake word) "${text}"`);
          // Clear after a moment
          setTimeout(() => setPartial(''), 2000);
        }
      }
    };

    Voice.onSpeechEnd = () => {
      activeRef.current = false;
      setListening(false);
      if (enabledRef.current && !pausedRef.current) {
        restartTimer.current = setTimeout(startListening, 500);
      }
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      activeRef.current = false;
      setListening(false);
      retryCount.current += 1;
      const code = e.error?.code;
      const msg = e.error?.message || 'Unknown error';
      setError(`Voice error (${code}): ${msg}`);
      const delay = Math.min(1000 * retryCount.current, 5000);
      if (enabledRef.current && !pausedRef.current) {
        restartTimer.current = setTimeout(startListening, delay);
      }
    };

    return () => {
      Voice.onSpeechStart = undefined;
      Voice.onSpeechRecognized = undefined;
      Voice.onSpeechPartialResults = undefined;
      Voice.onSpeechResults = undefined;
      Voice.onSpeechEnd = undefined;
      Voice.onSpeechError = undefined;
    };
  }, []); // only run once

  // Start/stop based on enabled+paused
  useEffect(() => {
    if (enabled && !paused) {
      retryCount.current = 0;
      setError('');
      startListening();
    } else {
      stopListening();
    }
  }, [enabled, paused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(restartTimer.current);
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
    };
  }, []);

  return { listening, partial, error };
}
