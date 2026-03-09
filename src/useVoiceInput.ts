import { useEffect, useRef } from 'react';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';

const WAKE_WORD = 'cyrus';

interface Options {
  enabled: boolean;
  paused: boolean;
  onUtterance: (text: string) => void;
}

export function useVoiceInput({ enabled, paused, onUtterance }: Options) {
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
    Voice.stop().catch(() => {});
  };

  const startListening = () => {
    if (activeRef.current || !enabledRef.current || pausedRef.current) return;
    if (retryCount.current > 5) {
      retryCount.current = 0;
      return; // give up after 5 consecutive errors
    }
    activeRef.current = true;
    Voice.start('en-US').catch(() => {
      activeRef.current = false;
    });
  };

  // Set up Voice callbacks once
  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = (e.value?.[0] ?? '').trim();
      retryCount.current = 0;
      if (text.toLowerCase().startsWith(WAKE_WORD)) {
        onUtteranceRef.current(text);
      }
    };

    Voice.onSpeechEnd = () => {
      activeRef.current = false;
      if (enabledRef.current && !pausedRef.current) {
        restartTimer.current = setTimeout(startListening, 500);
      }
    };

    Voice.onSpeechError = (_e: SpeechErrorEvent) => {
      activeRef.current = false;
      retryCount.current += 1;
      const delay = Math.min(1000 * retryCount.current, 5000);
      if (enabledRef.current && !pausedRef.current) {
        restartTimer.current = setTimeout(startListening, delay);
      }
    };

    return () => {
      Voice.onSpeechResults = undefined;
      Voice.onSpeechEnd = undefined;
      Voice.onSpeechError = undefined;
    };
  }, []); // only run once

  // Start/stop based on enabled+paused
  useEffect(() => {
    if (enabled && !paused) {
      retryCount.current = 0;
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
}
