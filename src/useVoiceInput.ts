import { useEffect, useRef, useState, useCallback } from 'react';
import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@react-native-voice/voice';
import * as Haptics from 'expo-haptics';

export interface VoiceStatus {
  listening: boolean;
  partial: string;
  error: string;
  start: () => void;
  stop: () => void;
}

interface Options {
  onUtterance: (text: string) => void;
}

export function useVoiceInput({ onUtterance }: Options): VoiceStatus {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;

  // Set up Voice callbacks once
  useEffect(() => {
    Voice.onSpeechStart = () => {
      setListening(true);
      setError('');
    };

    Voice.onSpeechPartialResults = (e: { value?: string[] }) => {
      const text = (e.value?.[0] ?? '').trim();
      if (text) setPartial(text);
    };

    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = (e.value?.[0] ?? '').trim();
      setListening(false);
      setPartial('');
      if (text) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onUtteranceRef.current(text);
      }
    };

    Voice.onSpeechEnd = () => {
      setListening(false);
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      setListening(false);
      setPartial('');
      const code = e.error?.code;
      const msg = e.error?.message || 'Unknown error';
      // code 7 = no speech detected, not really an error
      if (code === '7' || code === 7) {
        setError('No speech detected — tap mic to try again');
      } else {
        setError(`Voice error (${code}): ${msg}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    };

    return () => {
      Voice.onSpeechStart = undefined;
      Voice.onSpeechPartialResults = undefined;
      Voice.onSpeechResults = undefined;
      Voice.onSpeechEnd = undefined;
      Voice.onSpeechError = undefined;
    };
  }, []);

  const start = useCallback(async () => {
    setError('');
    setPartial('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Voice.start('en-US');
    } catch (err: any) {
      setError(`Mic start failed: ${err?.message || err}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, []);

  const stop = useCallback(() => {
    Voice.stop().catch(() => {});
    setListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
    };
  }, []);

  return { listening, partial, error, start, stop };
}
