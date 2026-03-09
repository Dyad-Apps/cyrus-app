import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, PermissionsAndroid,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
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
    brain.send(text, false);
  }, [brain.send]);

  useVoiceInput({
    enabled: voiceMode && brain.status === 'connected',
    paused: isSpeaking,
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

  const isPermissionPrompt = (text: string) =>
    text.toLowerCase().includes('allow command') || text.toLowerCase().includes('say yes or no');

  const handlePermission = (answer: string) => {
    brain.send(answer, false);
  };

  const renderMessage = ({ item }: { item: BrainMessage }) => {
    const isSystem = item.type === 'system';
    const isSent = item.type === 'sent';
    const isPermission = item.type === 'received' && isPermissionPrompt(item.text);
    return (
      <View style={[
        styles.msgRow,
        isSent ? styles.msgRowRight : styles.msgRowLeft,
      ]}>
        <View style={[
          styles.msgBubble,
          isSystem ? styles.msgSystem :
          isSent ? styles.msgSent : styles.msgReceived,
          isPermission && styles.msgPermission,
        ]}>
          <Text style={[
            styles.msgText,
            isSystem && styles.msgSystemText,
          ]}>
            {item.text}
          </Text>
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
          <Text style={styles.msgTime}>
            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
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
            onPress={async () => {
              if (!voiceMode && Platform.OS === 'android') {
                const granted = await PermissionsAndroid.request(
                  PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                  { title: 'Microphone', message: 'Cyrus needs mic access for voice mode', buttonPositive: 'Allow' }
                );
                if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
              }
              setVoiceMode(!voiceMode);
            }}
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

      {brain.thinking && (
        <View style={styles.thinkingBar}>
          <Text style={styles.thinkingText}>Cyrus is thinking...</Text>
        </View>
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Message Cyrus..."
          placeholderTextColor="#666"
          returnKeyType="send"
          onSubmitEditing={handleSend}
          multiline={false}
        />
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
  msgPermission: {
    backgroundColor: '#3a2a00',
    borderColor: '#ffaa00',
    borderWidth: 1,
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
