import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, PermissionsAndroid,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import Markdown from 'react-native-markdown-display';
import { useBrain, BrainMessage, ConnectionStatus } from './src/useBrain';
import Settings, { BrainConfig, loadConfig } from './src/Settings';
import { useVoiceInput } from './src/useVoiceInput';

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: '#ff4444',
  connecting: '#ffaa00',
  connected: '#44cc44',
};

export default function App() {
  const [config, setConfig] = useState<BrainConfig>({ host: '', port: 8769 });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inputText, setInputText] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const brain = useBrain(config);

  const handleVoiceUtterance = useCallback((text: string) => {
    brain.send(text, true);
  }, [brain.send]);

  const voice = useVoiceInput({
    onUtterance: handleVoiceUtterance,
  });

  useEffect(() => {
    loadConfig().then(cfg => {
      setConfig(cfg);
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (configLoaded && config.host) {
      brain.connect();
    }
  }, [configLoaded, config.host, config.port]);


  useEffect(() => {
    if (!voiceMode || brain.messages.length === 0) return;
    const last = brain.messages[brain.messages.length - 1];
    if (last.type === 'received') {
      const words = last.text.split(/\s+/);
      const spoken = words.length > 50
        ? words.slice(0, 50).join(' ') + '. See the chat for the full response.'
        : last.text;
      setIsSpeaking(true);
      Speech.speak(spoken, { rate: 1.0, pitch: 1.0, onDone: () => setIsSpeaking(false), onStopped: () => setIsSpeaking(false), onError: () => setIsSpeaking(false) });
    }
  }, [brain.messages.length, voiceMode]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    brain.send(inputText, !voiceMode);
    setInputText('');
  };

  const handleConfigSave = (cfg: BrainConfig) => {
    brain.disconnect();
    setConfig(cfg);
  };

  const handleMicPress = async () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    // Request permission if needed
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        { title: 'Microphone', message: 'Cyrus needs mic access for voice input', buttonPositive: 'Allow' }
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    voice.start();
  };

  const handlePermission = (answer: string) => {
    brain.send(answer, false);
  };

  const renderMessage = ({ item }: { item: BrainMessage }) => {
    const isSystem = item.type === 'system';
    const isSent = item.type === 'sent';
    const isReceived = item.type === 'received';
    const isPermission = item.type === 'permission';
    const isCompacting = isSystem && item.subtype === 'compacting';
    return (
      <View style={[
        styles.msgRow,
        isSent ? styles.msgRowRight : styles.msgRowLeft,
      ]}>
        <View style={[
          styles.msgBubble,
          isSystem ? styles.msgSystem :
          isSent ? styles.msgSent :
          isPermission ? styles.msgPermission : styles.msgReceived,
          isCompacting && styles.msgCompacting,
        ]}>
          {isReceived ? (
            <Markdown style={markdownStyles}>{item.text}</Markdown>
          ) : isCompacting ? (
            <Text style={styles.msgCompactingText}>Compacting context...</Text>
          ) : (
            <Text style={[
              styles.msgText,
              isSystem && styles.msgSystemText,
              isPermission && styles.msgPermissionText,
            ]}>
              {item.text}
            </Text>
          )}
          {isPermission && (
            <View style={styles.permissionBtns}>
              <TouchableOpacity
                style={styles.permissionYes}
                onPress={() => handlePermission('yes')}
              >
                <Text style={styles.permissionBtnText}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.permissionNo}
                onPress={() => handlePermission('no')}
              >
                <Text style={styles.permissionBtnText}>No</Text>
              </TouchableOpacity>
            </View>
          )}
          {!isCompacting && (
            <Text style={styles.msgTime}>
              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[brain.status] }]} />
          <Text style={styles.headerTitle}>Cyrus</Text>
          <Text style={styles.headerStatus}>{brain.status}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.headerBtn, voiceMode && styles.headerBtnActive]}
            onPress={() => setVoiceMode(!voiceMode)}
          >
            <Text style={styles.headerBtnText}>{voiceMode ? 'Voice' : 'Text'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => {
              if (brain.status === 'connected') brain.disconnect();
              else brain.connect();
            }}
          >
            <Text style={styles.headerBtnText}>
              {brain.status === 'connected' ? 'Disconnect' : 'Connect'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowSettings(true)}>
            <Text style={styles.headerBtnText}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={brain.messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Cyrus Mobile</Text>
            <Text style={styles.emptyText}>
              {config.host
                ? `Connecting to ${config.host}:${config.port}...`
                : 'Tap Settings to configure Brain connection'}
            </Text>
          </View>
        }
      />

      {(brain.thinking || brain.compacting) && (
        <View style={[styles.thinkingBar, brain.compacting && styles.compactingBar]}>
          <Text style={[styles.thinkingText, brain.compacting && styles.compactingText]}>
            {brain.compacting ? 'Compacting context...' : 'Cyrus is thinking...'}
          </Text>
        </View>
      )}

      {(voice.listening || voice.partial || voice.error) && (
        <View style={styles.voiceBar}>
          <View style={[styles.micDot, voice.listening && styles.micDotActive]} />
          <Text style={styles.voiceBarText}>
            {voice.error
              ? voice.error
              : voice.partial
              ? voice.partial
              : 'Listening...'}
          </Text>
        </View>
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder={voiceMode ? 'Tap mic or type...' : 'Message Cyrus...'}
          placeholderTextColor="#666"
          returnKeyType="send"
          onSubmitEditing={handleSend}
          multiline={false}
        />
        {voiceMode && (
          <TouchableOpacity
            style={[styles.micBtn, voice.listening && styles.micBtnActive]}
            onPress={handleMicPress}
          >
            <Text style={styles.micBtnText}>{voice.listening ? 'Stop' : 'Mic'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>

      {showSettings && (
        <Settings
          config={config}
          onSave={handleConfigSave}
          onClose={() => setShowSettings(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const markdownStyles = StyleSheet.create({
  body: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
  },
  heading1: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700' as const,
    marginBottom: 8,
    marginTop: 4,
  },
  heading2: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 6,
    marginTop: 4,
  },
  heading3: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600' as const,
    marginBottom: 4,
    marginTop: 4,
  },
  strong: {
    color: '#fff',
    fontWeight: '700' as const,
  },
  em: {
    color: '#ccc',
    fontStyle: 'italic' as const,
  },
  link: {
    color: '#4a9eff',
    textDecorationLine: 'underline' as const,
  },
  code_inline: {
    backgroundColor: '#1a1a1a',
    color: '#e8912d',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  fence: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  code_block: {
    color: '#e0e0e0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
  },
  blockquote: {
    backgroundColor: '#1a1a2e',
    borderLeftColor: '#4a9eff',
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginVertical: 4,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    color: '#fff',
    marginBottom: 2,
  },
  hr: {
    borderColor: '#444',
    marginVertical: 8,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 6,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 90 : 50,
    paddingBottom: 12,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerStatus: {
    color: '#888',
    fontSize: 12,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
  },
  headerBtnActive: {
    backgroundColor: '#4a9eff',
  },
  headerBtnText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: 16,
    paddingBottom: 8,
  },
  msgRow: {
    marginBottom: 8,
  },
  msgRowLeft: {
    alignItems: 'flex-start',
  },
  msgRowRight: {
    alignItems: 'flex-end',
  },
  msgBubble: {
    maxWidth: '85%',
    borderRadius: 16,
    padding: 12,
    paddingBottom: 6,
  },
  msgSent: {
    backgroundColor: '#4a9eff',
    borderBottomRightRadius: 4,
  },
  msgReceived: {
    backgroundColor: '#2a2a2a',
    borderBottomLeftRadius: 4,
  },
  msgSystem: {
    backgroundColor: 'transparent',
    alignSelf: 'center',
    padding: 4,
  },
  thinkingBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#1a1a2e',
  },
  thinkingText: {
    color: '#4a9eff',
    fontSize: 13,
    fontStyle: 'italic',
  },
  compactingBar: {
    backgroundColor: '#2a1a2e',
  },
  compactingText: {
    color: '#cc88ff',
  },
  msgPermission: {
    backgroundColor: '#3a2a00',
    borderColor: '#ffaa00',
    borderWidth: 1,
  },
  msgPermissionText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
  },
  msgCompacting: {
    backgroundColor: 'transparent',
    alignSelf: 'center',
    padding: 4,
  },
  msgCompactingText: {
    color: '#cc88ff',
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  permissionBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  permissionYes: {
    flex: 1,
    backgroundColor: '#44cc44',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  permissionNo: {
    flex: 1,
    backgroundColor: '#ff4444',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  permissionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  msgText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
  },
  msgSystemText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  msgTime: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a2e',
    gap: 8,
  },
  micDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#666',
  },
  micDotActive: {
    backgroundColor: '#ff4444',
  },
  voiceBarText: {
    color: '#aaa',
    fontSize: 12,
    flex: 1,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
  },
  micBtn: {
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#4a9eff',
  },
  micBtnActive: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
  },
  micBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  sendBtn: {
    backgroundColor: '#4a9eff',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
